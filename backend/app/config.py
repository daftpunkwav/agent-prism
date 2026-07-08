"""应用配置：从 .env 与用户配置 JSON 加载 BYOK 设置。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
PROVIDER_CONFIG_PATH = DATA_DIR / "provider_config.json"


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
    llm_api_format: Literal["anthropic_messages", "openai_chat"] = "anthropic_messages"
    llm_temperature: float = 0.0
    backend_host: str = "127.0.0.1"
    backend_port: int = 8000
    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()


class ProviderConfig(BaseSettings):
    """用户可在 Settings 页面覆盖的运行时 Provider 配置。"""

    provider_name: str = "StepFun"
    notes: str = ""
    website_url: str = "https://platform.stepfun.com/step-plan"
    api_key: str = ""
    base_url: str = "https://api.stepfun.com/step_plan"
    use_full_url: bool = True
    api_format: Literal["anthropic_messages", "openai_chat"] = "anthropic_messages"
    auth_field: str = "ANTHROPIC_AUTH_TOKEN"
    model: str = "step-3.7-flash"
    temperature: float = 0.0
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


def save_provider_config(config: ProviderConfig) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PROVIDER_CONFIG_PATH.write_text(
        config.model_dump_json(indent=2),
        encoding="utf-8",
    )
