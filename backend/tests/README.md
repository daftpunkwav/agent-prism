# 测试已迁移

规范测试目录为仓库根：

```
AgentPrism/tests/
```

从仓库根运行：

```bash
PYTHONPATH=backend pytest tests/ -v
```

或在 `backend/` 下（`pyproject.toml` 的 `testpaths` 指向 `../tests`）：

```bash
cd backend && pytest -v
```
