"""AgentPrism FastAPI 入口。"""

import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import arena, settings
from app.config import settings as app_settings

# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """应用生命周期：替代已废弃的 on_event 装饰器。"""
    logger.info("AgentPrism 启动完成")
    logger.info("Provider: %s, Model: %s", app_settings.llm_provider_name, app_settings.llm_model)
    yield
    logger.info("AgentPrism 关闭")


app = FastAPI(title="AgentPrism", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=app_settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 请求体大小限制中间件（防止超大请求）
@app.middleware("http")
async def limit_request_size(request: Request, call_next):
    max_bytes = app_settings.max_request_size
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > max_bytes:
        logger.warning("拒绝超大请求: %s (%s bytes)", request.url.path, content_length)
        return JSONResponse(
            status_code=413,
            content={"detail": f"请求体超过最大限制 ({max_bytes // 1024 // 1024}MB)"},
        )
    return await call_next(request)


app.include_router(settings.router)
app.include_router(arena.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "agentprism"}
