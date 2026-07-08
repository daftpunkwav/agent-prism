"""AgentPrism FastAPI 入口。"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import arena, settings
from app.config import settings as app_settings

app = FastAPI(title="AgentPrism", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=app_settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 请求体大小限制中间件（防止超大请求）
MAX_REQUEST_SIZE = 10 * 1024 * 1024  # 10MB


@app.middleware("http")
async def limit_request_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_REQUEST_SIZE:
        return JSONResponse(
            status_code=413,
            content={"detail": f"请求体超过最大限制 ({MAX_REQUEST_SIZE // 1024 // 1024}MB)"},
        )
    return await call_next(request)


app.include_router(settings.router)
app.include_router(arena.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "agentprism"}
