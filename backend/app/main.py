"""AgentPrism FastAPI 入口。"""

import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api import arena, settings
from app.config import settings as app_settings

# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

# 降低 HTTP 客户端噪音，避免 Authorization / API Key 进入 INFO 日志
for _noisy in ("httpx", "httpcore", "openai", "urllib3", "anthropic"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """应用生命周期：替代已废弃的 on_event 装饰器。"""
    logger.info("AgentPrism 启动完成")
    logger.info("Provider: %s, Model: %s", app_settings.llm_provider_name, app_settings.llm_model)
    yield
    logger.info("AgentPrism 关闭")


class RequestSizeLimitMiddleware:
    """限制请求体大小：同时检查 Content-Length 与实际流式字节数。

    仅依赖 Content-Length 可被无头/谎报绕过；本中间件在 ASGI receive
    路径累计 body 字节，超限立即返回 413。
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {
            k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])
        }
        content_length = headers.get("content-length")
        if content_length is not None:
            try:
                length = int(content_length)
            except ValueError:
                await self._send_json(send, 400, "无效的 Content-Length 头")
                return
            if length > self.max_bytes:
                logger.warning("拒绝超大请求: %s (%s bytes)", scope.get("path"), length)
                await self._send_json(
                    send,
                    413,
                    f"请求体超过最大限制 ({self.max_bytes // 1024 // 1024}MB)",
                )
                return

        received = 0
        rejected = False
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received, rejected
            message = await receive()
            if message["type"] == "http.request" and not rejected:
                chunk = message.get("body", b"") or b""
                received += len(chunk)
                if received > self.max_bytes:
                    rejected = True
                    logger.warning(
                        "拒绝超大请求体流: %s (%s+ bytes)",
                        scope.get("path"),
                        received,
                    )
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        async def send_wrapper(message: Message) -> None:
            nonlocal response_started, rejected
            if rejected and not response_started:
                response_started = True
                await self._send_json(
                    send,
                    413,
                    f"请求体超过最大限制 ({self.max_bytes // 1024 // 1024}MB)",
                )
                return
            if rejected:
                return
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        await self.app(scope, limited_receive, send_wrapper)
        if rejected and not response_started:
            await self._send_json(
                send,
                413,
                f"请求体超过最大限制 ({self.max_bytes // 1024 // 1024}MB)",
            )

    @staticmethod
    async def _send_json(send: Send, status: int, detail: str) -> None:
        import json

        body = json.dumps({"detail": detail}, ensure_ascii=False).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json; charset=utf-8"),
                    (b"content-length", str(len(body)).encode("latin-1")),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


class ApiTokenMiddleware:
    """可选共享密钥认证。

    当 ``AGENTPRISM_API_TOKEN`` / ``api_token`` 非空时，除 ``/api/health`` 外
    要求 ``Authorization: Bearer <token>`` 或 ``X-API-Token``。
    未配置时保持本机零摩擦（向后兼容）。
    """

    def __init__(self, app: ASGIApp, token: str) -> None:
        self.app = app
        self.token = token

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self.token:
            await self.app(scope, receive, send)
            return
        path = scope.get("path") or ""
        if path == "/api/health":
            await self.app(scope, receive, send)
            return
        headers = {
            k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])
        }
        auth = headers.get("authorization", "")
        x_token = headers.get("x-api-token", "")
        ok = (auth.lower().startswith("bearer ") and auth[7:] == self.token) or (
            x_token == self.token
        )
        if not ok:
            body = '{"detail":"未授权：需要有效的 API Token"}'.encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 401,
                    "headers": [
                        (b"content-type", b"application/json; charset=utf-8"),
                        (b"content-length", str(len(body)).encode("latin-1")),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)


app = FastAPI(title="AgentPrism", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=app_settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Starlette 中间件 LIFO：后加的先执行
app.add_middleware(RequestSizeLimitMiddleware, max_bytes=app_settings.max_request_size)
if app_settings.api_token:
    app.add_middleware(ApiTokenMiddleware, token=app_settings.api_token)

app.include_router(settings.router)
app.include_router(arena.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "agentprism"}
