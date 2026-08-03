# 测试已迁移

规范测试目录为仓库根：

```
AgentPrism/tests/
```

当前规模（2026-08-03）：**29** 个 `test_*.py` / **268** 个 `test_` 函数。

从仓库根运行：

```bash
PYTHONPATH=backend pytest tests/ -v
```

或在 `backend/` 下（`pyproject.toml` 的 `testpaths` 指向 `../tests`）：

```bash
cd backend && pytest -v
```

CI 同步执行 ruff、mypy 与 pytest，详见 `.github/workflows/ci.yml`。
