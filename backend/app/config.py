"""应用配置：从 .env 与用户配置 JSON 加载 BYOK 设置。"""

from __future__ import annotations

import json
import os
import tempfile
from functools import cached_property
from pathlib import Path

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.arena.types import ApiFormat

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
PROVIDER_CONFIG_PATH = DATA_DIR / "provider_config.json"


def _atomic_write_json(path: Path, payload: str) -> bool:
    """原子写入 JSON：先写 .tmp，再 rename，旧文件备份为 .bak。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(payload)
        # 先备份旧文件
        bak_path = path.with_suffix(path.suffix + ".bak")
        if path.exists():
            try:
                path.replace(bak_path)
            except OSError:
                pass
        os.replace(tmp_path, str(path))
        return True
    except OSError:
        # 清理临时文件
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        return False


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    llm_provider_name: str = "StepFun"
    llm_api_key: str = ""
    llm_base_url: str = "https://api.stepfun.com/step_plan"
    llm_model: str = "step-3.7-flash"
    llm_api_format: ApiFormat = "anthropic_messages"
    llm_temperature: float = 0.0
    backend_host: str = "127.0.0.1"
    # 默认 8000；若 8000 被占用可通过环境变量或启动参数覆盖
    backend_port: int = 8000
    # CORS 允许的前端 origin，逗号分隔
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    # 请求体大小上限（字节），超过返回 413
    max_request_size: int = 10 * 1024 * 1024

    @cached_property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()


class ProviderConfig(BaseModel):
    """用户在 Settings 页面配置的运行时 Provider 设置。仅从 JSON 加载，不读 env。"""

    provider_name: str = "StepFun"
    notes: str = ""
    website_url: str = "https://platform.stepfun.com/step-plan"
    api_key: str = ""
    base_url: str = "https://api.stepfun.com/step_plan"
    use_full_url: bool = True
    api_format: ApiFormat = "anthropic_messages"
    auth_field: str = "ANTHROPIC_AUTH_TOKEN"
    model: str = "step-3.7-flash"
    temperature: float = 0.0
    top_p: float = 1.0
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0
    context_window: int = 128_000
    max_input_tokens: int = 120_000
    max_output_tokens: int = 2048


def load_provider_config() -> ProviderConfig:
    """优先读取 data/provider_config.json，否则回退到 .env。"""
    if PROVIDER_CONFIG_PATH.exists():
        data = json.loads(PROVIDER_CONFIG_PATH.read_text(encoding="utf-8"))
        return ProviderConfig(**data)

    return ProviderConfig(
        provider_name=settings.llm_provider_name,
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
        model=settings.llm_model,
        api_format=settings.llm_api_format,
        temperature=settings.llm_temperature,
    )


def save_provider_config(config: ProviderConfig) -> bool:
    """保存 Provider 配置到 JSON 文件（原子写入 + .bak 备份）。返回是否成功。"""
    json_str = config.model_dump_json(indent=2)
    return _atomic_write_json(PROVIDER_CONFIG_PATH, json_str)
