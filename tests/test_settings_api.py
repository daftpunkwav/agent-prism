"""Provider 设置 API 测试 — 脱敏、空 key 保留、连接测试成功/失败路径。"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.config import ProviderConfig
from app.main import app

client = TestClient(app)


def test_get_provider_returns_masked_key(isolated_provider_file, monkeypatch):
    """GET /api/settings/provider 返回脱敏后的 key，不泄露完整值。"""
    from app.api import settings as settings_module

    monkeypatch.setattr(
        settings_module,
        "load_provider_config",
        lambda: ProviderConfig(api_key="sk-1234567890abcdef"),
    )
    res = client.get("/api/settings/provider")
    assert res.status_code == 200
    data = res.json()
    assert data["api_key_set"] is True
    assert data["api_key_preview"] == "sk-1...cdef"
    assert "1234567890" not in data["api_key_preview"]


def test_update_provider_keeps_existing_key(isolated_provider_file, monkeypatch):
    """PUT 时 api_key 留空应保留已保存的 key，不覆盖为空。"""
    from app.api import settings as settings_module

    saved: dict = {}

    def fake_load() -> ProviderConfig:
        return ProviderConfig(**(saved or {"api_key": "sk-old-key-1234"}))

    def fake_save(cfg: ProviderConfig) -> None:
        saved.update(cfg.model_dump())

    monkeypatch.setattr(settings_module, "load_provider_config", fake_load)
    monkeypatch.setattr(settings_module, "save_provider_config", fake_save)

    res = client.put("/api/settings/provider", json={"temperature": 0.7})
    assert res.status_code == 200
    assert saved["api_key"] == "sk-old-key-1234"
    assert saved["temperature"] == 0.7


def test_provider_test_anthropic_success(isolated_provider_file):
    """POST /api/settings/provider/test：Anthropic SDK 调用成功路径。"""
    fake_client = MagicMock()
    block = MagicMock()
    block.text = "pong"
    fake_client.messages.create.return_value = MagicMock(content=[block])

    with patch("app.api.settings.anthropic.Anthropic", return_value=fake_client):
        res = client.post(
            "/api/settings/provider/test",
            json={"api_key": "sk-test", "model": "m", "api_format": "anthropic_messages"},
        )
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert "pong" in data["message"]
    assert data["model"] == "m"


def test_provider_test_anthropic_failure(isolated_provider_file):
    """POST /api/settings/provider/test：SDK 抛异常 → ok=False 且仅暴露类型名。"""
    with patch(
        "app.api.settings.anthropic.Anthropic",
        side_effect=RuntimeError("boom secret-key-abc"),
    ):
        res = client.post(
            "/api/settings/provider/test",
            json={"api_key": "sk-test", "model": "m", "api_format": "anthropic_messages"},
        )
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is False
    assert data["message"] == "连接失败: RuntimeError"
    assert "secret-key" not in data["message"]


def test_provider_test_openai_success(isolated_provider_file):
    """POST /api/settings/provider/test：OpenAI SDK 调用成功路径。"""
    fake_client = MagicMock()
    choice = MagicMock()
    choice.message.content = "pong"
    fake_client.chat.completions.create.return_value = MagicMock(choices=[choice])

    # openai 在 _test_openai_sync 内延迟导入 — patch 模块属性即可生效
    with patch("openai.OpenAI", return_value=fake_client):
        res = client.post(
            "/api/settings/provider/test",
            json={"api_key": "sk-test", "model": "m", "api_format": "openai_chat"},
        )
    assert res.status_code == 200
    assert res.json()["ok"] is True


def test_provider_test_without_key_returns_400(isolated_provider_file, monkeypatch):
    """未配置 API Key 时返回 400，不发 SDK 调用。"""
    from app.api import settings as settings_module

    monkeypatch.setattr(settings_module, "load_provider_config", lambda: ProviderConfig(api_key=""))
    res = client.post("/api/settings/provider/test", json={})
    assert res.status_code == 400
    assert "API Key" in res.json()["detail"]
