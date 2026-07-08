"""AgentPrism FastAPI 入口。"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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

app.include_router(settings.router)
app.include_router(arena.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "agentprism"}
