"""URL 校验 — 防止 base_url SSRF / Key 外泄，以及 website_url 点击 XSS。"""

from __future__ import annotations

import ipaddress
import re
from urllib.parse import urlparse

__all__ = [
    "UrlValidationError",
    "validate_website_url",
    "validate_llm_base_url",
]

# 明确拒绝的元数据 / 链路本地主机名（不依赖 DNS）
_BLOCKED_HOSTNAMES = frozenset(
    {
        "metadata.google.internal",
        "metadata.google.com",
        "instance-data",
        "kubernetes.default",
        "kubernetes.default.svc",
    }
)

_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "[::1]"})


class UrlValidationError(ValueError):
    """URL 未通过安全校验。"""


def _normalize_hostname(host: str) -> str:
    h = host.strip().lower().rstrip(".")
    if h.startswith("[") and h.endswith("]"):
        h = h[1:-1]
    return h


def _is_blocked_ip(host: str) -> bool:
    """字面量 IP 是否属于危险网段（链路本地 / 多播等）。

    回环地址单独处理（本地 LLM 网关允许）；此处只拦明确危险段。
    """
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    if ip.is_loopback:
        return False
    # 云元数据常见链路本地；以及多播/未指定
    if ip.is_link_local or ip.is_multicast or ip.is_unspecified or ip.is_reserved:
        return True
    return False


def _parse_http_url(url: str, *, field: str) -> tuple[str, str]:
    """解析并返回 (scheme, hostname)。空串允许。"""
    text = (url or "").strip()
    if not text:
        return "", ""
    # 拒绝明显非 http(s) 的 scheme（含 javascript: / data:）
    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", text) and not re.match(
        r"^https?://", text, re.IGNORECASE
    ):
        raise UrlValidationError(f"{field} 仅允许 http 或 https 协议")
    parsed = urlparse(text)
    scheme = (parsed.scheme or "").lower()
    if scheme not in ("http", "https"):
        raise UrlValidationError(f"{field} 仅允许 http 或 https 协议")
    host = _normalize_hostname(parsed.hostname or "")
    if not host:
        raise UrlValidationError(f"{field} 缺少主机名")
    if host in _BLOCKED_HOSTNAMES:
        raise UrlValidationError(f"{field} 主机名不被允许")
    if _is_blocked_ip(host):
        raise UrlValidationError(f"{field} 目标地址不被允许")
    return scheme, host


def validate_website_url(url: str) -> str:
    """校验设置页官网链接；空串通过。返回规范化后的原串（strip）。"""
    text = (url or "").strip()
    if not text:
        return ""
    _parse_http_url(text, field="website_url")
    return text


def validate_llm_base_url(url: str) -> str:
    """校验 LLM Provider base_url。

    规则：
    - 空串拒绝（Provider 必须有 endpoint）
    - https：任意非黑名单主机（公网 API）
    - http：仅允许回环主机（本地 Ollama 等），防止明文把 Key 发到远程
    """
    text = (url or "").strip()
    if not text:
        raise UrlValidationError("base_url 不能为空")
    scheme, host = _parse_http_url(text, field="base_url")
    if scheme == "http" and host not in _LOOPBACK_HOSTS:
        raise UrlValidationError("http 协议的 base_url 仅允许 localhost / 127.0.0.1 / ::1")
    return text.rstrip("/")
