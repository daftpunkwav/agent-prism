"""URL 校验：website_url / base_url 安全约束。"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.arena.url_validate import (
    UrlValidationError,
    validate_llm_base_url,
    validate_website_url,
)
from app.models import ProviderConfigUpdate


def test_website_url_rejects_javascript():
    with pytest.raises(UrlValidationError):
        validate_website_url("javascript:alert(1)")


def test_website_url_allows_https():
    assert validate_website_url("https://example.com/docs") == "https://example.com/docs"


def test_website_url_empty_ok():
    assert validate_website_url("") == ""


def test_base_url_rejects_http_remote():
    with pytest.raises(UrlValidationError, match="localhost"):
        validate_llm_base_url("http://evil.example/v1")


def test_base_url_allows_http_localhost():
    assert validate_llm_base_url("http://127.0.0.1:11434/v1").startswith("http://127.0.0.1")


def test_base_url_allows_https_public():
    assert "api.openai.com" in validate_llm_base_url("https://api.openai.com/v1")


def test_base_url_rejects_metadata_ip():
    with pytest.raises(UrlValidationError):
        validate_llm_base_url("http://169.254.169.254/latest/meta-data/")


def test_provider_update_model_validates():
    with pytest.raises(ValidationError):
        ProviderConfigUpdate(
            base_url="javascript:alert(1)",
            website_url="https://ok.example",
        )
    with pytest.raises(ValidationError):
        ProviderConfigUpdate(
            base_url="https://ok.example",
            website_url="javascript:alert(1)",
        )
