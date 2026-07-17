"""请求体大小限制中间件：非法 Content-Length → 400，超限 → 413。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_ok():
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_invalid_content_length_returns_400():
    res = client.post(
        "/api/arena/run",
        content=b"{}",
        headers={
            "Content-Type": "application/json",
            "Content-Length": "not-a-number",
        },
    )
    assert res.status_code == 400
    assert "Content-Length" in res.json().get("detail", "")


def test_oversized_content_length_returns_413():
    # 声明超大 Content-Length（无需真发大 body）
    huge = 20 * 1024 * 1024
    res = client.post(
        "/api/arena/run",
        content=b"{}",
        headers={
            "Content-Type": "application/json",
            "Content-Length": str(huge),
        },
    )
    assert res.status_code == 413
