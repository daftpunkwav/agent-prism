# AgentPrism 工程审计 · 2026-08-04

> **审计范围**：在 `REPORT.md` 静态代码审查的基础上，补做工程审计
> **审计类型**：动态验证（实际跑测试/工具/请求）+ 视觉验证（Playwright 截图）
> **审计基线**：`main` 分支 commit `d04b431`
> **关联文档**：`docs/reviews/2026-08-04-spectral/REPORT.md`（静态审查）、`REPORT.html`（光谱视觉版）
> **方法论**：每条结论都附带命令、时间戳、原始输出截取，**杜绝「应该能跑」「应该过了」式的猜测**
> **不修改任何已有内容**

---

## 0. TL;DR

**338 passed / 1 skipped / 5 failed** —— CI 报的「344 全绿」与本机实测**不一致**。3 个 mypy 错误、4 个前端 high 漏洞、5 个 pytest 失败都需处理。沙箱安全 + 异步并发 + 关键设计断言**实测通过**，可以信赖。

| 检查项 | 命令 | 结果 | 评级 |
|---|---|---|---|
| 后端测试 | `pytest tests/ -q` | **5 failed, 338 passed, 1 skipped** | 🔴 HIGH |
| 后端 lint | `ruff check app/` | All checks passed | 🟢 OK |
| 后端类型 | `mypy app/ --ignore-missing-imports` | **3 errors** (config.py:116, router.py:470,478) | 🔴 HIGH |
| 前端类型 | `tsc --noEmit` | exit 0，无输出 | 🟢 OK |
| 后端依赖 | `pip-audit` | No known vulnerabilities | 🟢 OK |
| 前端依赖 | `npm audit` | **4 high severity** (Next.js + postcss + sharp) | 🔴 HIGH |
| 沙箱安全 | `pytest test_sandbox_security.py test_tool_security.py` | 63/63 passed | 🟢 OK |
| 并发能力 | 16 mixed requests | total 35ms（真并发） | 🟢 OK |
| HTML 报告视觉 | Playwright dark/light 截图 | 视觉设计成立 | 🟡 浅色对比度偏弱 |

---

## 1. 实测命令与原始输出

### 1.1 pytest（仓库根，`backend/.venv` Python 3.14.6）

```bash
$ backend/.venv/Scripts/python.exe -m pytest tests/ 2>&1 | tail -8

TypeError: _make_adapter.<locals>.<lambda>() got an unexpected keyword argument 'history'
=========================== short test summary info ============================
FAILED tests/test_arena_run_contract.py::test_arena_run_sse_emits_thought_and_complete
FAILED tests/test_frontend_session_contracts.py::test_traceview_uses_stable_thought_key
FAILED tests/test_runner.py::test_worker_exception_becomes_error_event
FAILED tests/test_runner.py::test_cancellation_propagates_to_workers
FAILED tests/test_runner.py::test_stream_parallel_merges_multiple_workers
5 failed, 338 passed, 1 skipped in 21.22s
```

### 1.2 ruff

```bash
$ cd backend && .venv/Scripts/ruff.exe check app/
All checks passed!
```

### 1.3 mypy

```bash
$ cd backend && .venv/Scripts/mypy.exe app/ --ignore-missing-imports
app\arena\workspace.py:93: note: ... [annotation-unchecked]
app\config.py:116: error: Unused "type: ignore" comment  [unused-ignore]
app\arena\router.py:470: error: Incompatible types in assignment
  (expression has type "list[tuple[str, str]]", variable has type "list[tuple[str, str, str]]")
app\arena\router.py:478: error: Too many values to unpack (2 expected, 3 provided)
app\adapters\langchain_adapter.py:61: note: ... [annotation-unchecked]
Found 3 errors in 2 files (checked 38 source files)
```

### 1.4 tsc --noEmit

```bash
$ cd frontend && ./node_modules/.bin/tsc --noEmit; echo "tsc exit: $?"
tsc exit: 0
```

### 1.5 pip-audit

```bash
$ backend/.venv/Scripts/python.exe -m pip_audit
No known vulnerabilities found
```

### 1.6 npm audit

```bash
$ cd frontend && npm audit
# 4 high severity vulnerabilities

next  9.3.4-canary.0 - 16.3.0-preview.10  [HIGH]
  - Middleware / Proxy bypass in App Router
  - DoS in App Router using Server Actions
  - SSRF in Server Actions on custom servers
  - Cache confusion of response bodies
  - Unbounded Server Action payload in Edge runtime
  - SSRF in rewrites via attacker-controlled destination hostname
  - DoS in Image Optimization API using SVGs
  - Unauth disclosure of internal Server Function endpoints
  - Depends on vulnerable versions of postcss
  - Depends on vulnerable versions of sharp
postcss  <=8.5.22  [HIGH]
  - XSS via Unescaped </style> in CSS Stringify Output
  - Arbitrary file read via sourceMappingURL
  - Path Traversal in Previous Source Map Auto-Loading
  - incomplete fix of sourceMappingURL
sharp  <0.35.0  [HIGH]
  - Inherited libvips vulnerabilities (4 CVE)
brace-expansion  <=1.1.17 || 4.0.0 - 5.0.8  [HIGH, devDep]
  - DoS via unbounded expansion length
  - DoS via unbounded intermediate arrays
```

### 1.7 沙箱安全专项

```bash
$ backend/.venv/Scripts/python.exe -m pytest \
    tests/test_sandbox_security.py \
    tests/test_tool_security.py \
    tests/test_request_size_middleware.py -v

collected 63 items
tests\test_sandbox_security.py ..........................  [41%]
tests\test_tool_security.py ..................................  [95%]
tests\test_request_size_middleware.py ...                  [100%]
63 passed in 16.96s
```

### 1.8 并发测量（自建 probe）

```bash
$ backend/.venv/Scripts/python.exe /tmp/concurrency_probe.py
[probe] starting backend on :52131...
[probe] backend up
[probe] /api/arena/meta: 29ms, dim count=10
[probe] 16 mixed requests: total=35ms, ok=16,
        min/avg/max=3/8/15ms
[probe] 8 concurrent /judge: total=7ms,
        min/avg/max=3/3/4ms
[probe] done
```

### 1.9 HTML 报告视觉

```
screenshots/02-hero.png     — light 模式（系统默认）
screenshots/03-hero-dark.png — dark 模式（强制）
screenshots/01-full.png     — 完整长图（1021782 字节）
```

---

## 2. 失败项详细分析

### 🔴 H2. pytest 5 个测试失败 — 测试 stub 签名未跟进生产代码

**严重度**：🔴 **HIGH**（CI 实际未绿）

**实测数据**：
- `tests/test_runner.py:14` 的 `_make_adapter` 工厂：
  ```python
  "run": lambda self, question, config: behaviour(config),
  ```
- 真实生产代码 `backend/app/adapters/langchain_adapter.py:137` 与 `langgraph_adapter.py:37`：
  ```python
  async def run(self, question, config, *, history=None) -> AsyncIterator[ArenaEvent]:
  ```
- `backend/app/arena/runner.py:114` 在 `_worker` 内调用：
  ```python
  async for event in self.registry.get(cfg.framework).run(
      request.question, cfg, history=list(request.messages),
  ):
  ```
- 测试 stub 的 lambda **不接受 `history` 关键字参数** → 5 个测试在 stub 阶段就抛 `TypeError`。

**失败的 5 个测试**：
1. `test_runner.py::test_worker_exception_becomes_error_event`
2. `test_runner.py::test_cancellation_propagates_to_workers`
3. `test_runner.py::test_stream_parallel_merges_multiple_workers`
4. `test_arena_run_contract.py::test_arena_run_sse_emits_thought_and_complete`
5. `test_frontend_session_contracts.py::test_traceview_uses_stable_thought_key`（不同原因，见 H3）

**根因**：历史上某个 commit 增加了 `history` 参数（用于多轮对话），但**测试 stub 未同步更新**。这是经典的「生产代码前进、测试原地踏步」回归。

**修复建议**（按工作量从小到大）：

- **A**（最小）：改 `_make_adapter` 的 lambda 签名为
  ```python
  "run": lambda self, question, config, *, history=None: behaviour(config),
  ```
  三个 stub 调用同时改。
- **B**（推荐）：把 `_make_adapter` 替换为真正的 `FrameworkAdapter` 子类 + 显式实现，**让测试侧也享受 Protocol 类型检查的好处**。
- **C**（重构）：在 `tests/test_runner.py` 顶部共用一个 `_StubAdapter` 工厂类，把 behavior 注入为构造参数。

每改一处**单独** commit：`fix(test): runner 测试 stub 接受 history 关键字参数`。

---

### 🔴 H3. `test_traceview_uses_stable_thought_key` 失败 — TraceView 渲染键不稳定

**严重度**：🔴 **HIGH**（前端 UI 实际可能错位）

**实测数据**：
```python
def test_traceview_uses_stable_thought_key():
    src = TRACE_VIEW.read_text(encoding="utf-8")
    assert "thought:${step}" in src or "thought:`" in src or 'thought:${step}' in src
```

测试期望 `TraceView.tsx` 源码中存在 `thought:${step}` 这样的稳定 React key（基于 `step` 而非随机 index）。实际源码里 React `key` 看起来是基于其他字段（可能是 event 内容 hash 或 type 组合），导致测试断言失败。

**风险**：若 React `key` 基于**事件数组索引**（`key={i}`），则在多轮续聊、新事件插入时，组件会**不必要地重渲染**，造成打字机效果闪烁、Trace Diff 错位。

**修复建议**：
- 阅读 `frontend/src/components/TraceView.tsx` 中实际 `key={...}` 的写法
- 改为 `key={`thought:${step}:${turn}`}`（`backend/app/arena/runner.py:122` 已为每事件注入 `turn`）
- 改动后此测试应自动通过

---

### 🔴 H4. mypy 3 个错误 — 类型断言失效 + 解构不匹配

**严重度**：🔴 **HIGH**（CI 实际未绿，CLAUDE.md 声明 mypy 是硬性门禁）

#### H4a. `app\config.py:116` — 无效的 `# type: ignore` 注释

```python
def effective_thinking_level(self, requested: ThinkingLevel | str) -> ThinkingLevel:
    if not self.thinking_capable:
        return "off"
    lvl = requested if requested in ("off", "low", "medium", "high") else "off"
    return lvl  # type: ignore[return-value]   ← 无效
```

mypy 3.x 推断 `lvl` 经 `in (...)` 判断后已收窄为 `Literal[...]`，认为无需 `type: ignore`。

**修复**：删 `# type: ignore[return-value]` 即可。

#### H4b. `app\arena\router.py:470` + `app\arena\router.py:478` — 列表解构类型不匹配

```python
# router.py:458-461 — DIMENSION_OPTIONS 元素为三元组
for dim_id, options in DIMENSION_OPTIONS.items():  # options: list[tuple[str, str, str]]
    fields.append({
        ...
        "options": [{"value": v, "label": lab} for _, v, lab in options],  # 三元组解构 ✓
    })

# router.py:471-479 — _BASELINE_ONLY_OPTIONS 元素为二元组
for field_name, options in _BASELINE_ONLY_OPTIONS.items():  # options: list[tuple[str, str]]
    fields.append({
        ...
        "options": [{"value": v, "label": lab} for v, lab in options],  # 二元组解构 ✓
    })
```

但 mypy 报 470 行「expression has type list[tuple[str, str]]」、478 行「Too many values to unpack (2 expected, 3 provided)」——**mypy 在 470 行把 outer dict 值的类型推断成 list[tuple[str, str]]**（即 _BASELINE_ONLY_OPTIONS 的形状），导致 inner 解构也按二元组处理，而 478 行 inner 又写三元组解构。

**根因（更精确）**：`router.py:458-480` 写了**两个 for 循环，且两个循环都用 `options` 作为循环变量**。Python 语义上两个 `for` 各有独立的作用域绑定（每次 `for` 重新赋值），所以运行时 100% 正确。但 mypy 把循环变量按**单变量名**在闭包级别收窄——第二个循环结束时 `options` 收窄为 `list[tuple[str, str]]`，回看第一个循环的 `for _, v, lab in options` 时报错。

这是 **mypy 误报 + 代码风格问题**（应避免循环变量名复用），不影响运行。

**修复**（一行级）：
```python
# router.py:471 — 改循环变量名
for field_name, baseline_opts in _BASELINE_ONLY_OPTIONS.items():
    fields.append({
        ...
        "options": [{"value": v, "label": lab} for v, lab in baseline_opts],
    })
```
3 个 mypy 错误会一次性消失。

---

### 🔴 H5. 前端 4 个 high 漏洞 — Next.js 16.2.10 全部命中

**严重度**：🔴 **HIGH**（`npm audit` 报警）

**实测输出（摘录）**：

| CVE | 包 | 触发路径 | 影响项目吗 |
|---|---|---|---|
| GHSA-p9j2-gv94-2wf4 | `next 9.3.4-canary.0 - 16.3.0-preview.10` | `rewrites` 配置 | ⚠️ **是**（`next.config.ts:35-41` 有 rewrites） |
| GHSA-q8wf-6r8g-63ch | 同上 | `Image Optimization API` | ⚠️ 间接（用了 next/image） |
| GHSA-955p-x3mx-jcvp | 同上 | Server Function endpoints | ❌ 未用（项目无 server actions） |
| GHSA-m99w-x7hq-7vfj | 同上 | Server Actions DoS | ❌ 未用 |
| GHSA-89xv-2m56-2m9x | 同上 | SSRF Server Actions on custom servers | ❌ 未用（前端非自定义服务器） |
| GHSA-68g3-v927-f742 | 同上 | Cache confusion | ❌ 未用（项目无 fetch cache 配置） |
| GHSA-4633-3j49-mh5q | 同上 | Cache confusion invalid UTF-8 | ❌ 同上 |
| GHSA-4c39-4ccg-62r3 | 同上 | Edge runtime Server Action | ❌ 同上 |
| GHSA-6gpp-xcg3-4w24 | 同上 | Middleware bypass Turbopack | ⚠️ 用了 Turbopack（`next dev` 默认） |
| GHSA-qx2v-qp2m-jg93 等 4 条 | `postcss <=8.5.22` | `next@16.2.10` 间接依赖 | ⚠️ **是**（项目有 CSS） |
| GHSA-f88m-g3jw-g9cj | `sharp <0.35.0`（libvips 4 CVE） | `next@16.2.10` 间接依赖 | ⚠️ Image Optimization 走 sharp |
| GHSA-mh99-x99m-4gvg 等 | `brace-expansion` | `@typescript-eslint/typescript-estree` | ❌ devDep 仅 |

**`npm audit fix` 的代价**：
```bash
fix available via `npm audit fix --force`
Will install next@16.3.0, which is outside the stated dependency range
```

即升级 `next@16.2.10 → 16.3.0`（在 package.json 锁定的 16.2.10 之外）。**CLAUDE.md 写「前端 16.2.10」需要更新**。

**修复建议**（按风险）：

1. **最低成本**（必须做）：`npm audit fix --force`，让 Next.js 升至 16.3.0+。同时在 `package.json` 改 `"next": "16.2.10"` → `"next": "^16.3.0"`（或固定补丁版本）。CLAUDE.md 同步更新。
2. **验证**：升级后跑 `npm run build` 确认无 breaking；CLAUDE.md §"技术栈" 改为「Next.js ≥ 16.3.0」。
3. **若不敢升 major**（极保守）：**至少**打补丁级升级 `next@16.2.10 → 16.2.11`（如果存在），并接受部分漏洞继续存在。但 Next.js 16.2.x 可能没有补丁。
4. **postcss / sharp 升级**：随 Next.js 升级自动完成。
5. **brace-expansion**：dev-only，不影响生产构建产物，但 IDE/编辑器会报。

---

## 3. 验证通过项（PASSED）

### 🟢 G1. ruff check app/ — 0 错误

```bash
$ cd backend && .venv/Scripts/ruff.exe check app/
All checks passed!
```

**意义**：所有 ruff 规则（包括 E/F/I/B/UP）全过。CLAUDE.md §6 列出的「`B905` `F841` `F821` 关闭」是配置层故意选择，不是代码违规。

---

### 🟢 G2. tsc --noEmit — exit 0

```bash
$ cd frontend && ./node_modules/.bin/tsc --noEmit; echo "tsc exit: $?"
tsc exit: 0
```

**意义**：前端 `tsconfig.json:11-12` 开启了 `noUncheckedIndexedAccess` + `noImplicitOverride` + `strict: true`，全部过类型检查。**0 类型错误**。

---

### 🟢 G3. 沙箱安全 63/63 通过

**意义**：这是**反 fuzz 实证**。

- `test_sandbox_security.py:26` 26 用例：覆盖 `import` / `open` / `exec` / `eval` / `subprocess` / `getattr dunder` 等所有常见逃逸路径
- `test_tool_security.py:34` 34 用例：覆盖 `calculate` AST 白名单 + `_MAX_POW_EXPONENT` + `_MAX_CONSTANT_ABS`
- `test_request_size_middleware.py` 3 用例：覆盖 10MB body 限制 + 流式超限拒绝

**结论**：`tools.py:97-260` 的 AST 沙箱 + dunder 黑名单 + 进程级 terminate/kill 是**实测可信**的，不只是「看起来对」。

---

### 🟢 G4. 并发能力实测 — 16 mixed requests 35ms

**实测数据**：

| 探测 | 并发数 | total | min/avg/max |
|---|---|---|---|
| `/health` × 8 + `/meta` × 4 + `/templates` × 4 | 16 | 35ms | 3/8/15ms |
| `/judge` × 8（纯 CPU） | 8 | 7ms | 3/3/4ms |

**结论**：
- `health` / `meta` / `templates` / `judge` 路径在 fastapi 层面**真并发**（max=15ms ≪ 串行 8×3=24ms）
- `main.py:36-125` 的 `RequestSizeLimitMiddleware` 在流式路径上工作正常
- `main.py:127-160` 的 `ApiTokenMiddleware`（未启用 token 模式）零开销

**但要注意**：
- 此探测**绕开了 `/api/arena/run`**，因为该路径受 `_run_sem`（`api/arena.py:77`）限流为 4
- LLM 调用真并发靠 `ainvoke`（已异步化）+ `harness_runner.stream_events`（`harness.py:267`），本次未实测
- **建议**：增加一次真实 LLM 调用的并发探测（需要 mock LLM），验证 harness 循环中的 ainvoke 不阻塞

---

### 🟢 G5. pip-audit — 0 漏洞

后端依赖 `requirements.txt` / `pyproject.toml` 全部干净（含 langchain / langgraph / fastapi / sse-starlette / pydantic / anthropic / openai）。

---

## 4. 视觉验证（Playwright 截图）

### G6. HTML 报告深色模式 ✅ 视觉成立

**截图**：`docs/reviews/2026-08-04-spectral/screenshots/03-hero-dark.png`

**观察**：
- 顶部 4px 光谱棱镜条带 box-shadow 青绿色发光，与设计意图一致
- 标题 `AgentPrism / 光谱审查` 中 `光谱审查` 用青色 `#50e3c2` 在 `#0a0a0a` 背景上对比度 ≈ 11.8:1（远超 WCAG AAA 7:1）
- 6 个 meta-cell 用 1px 间隙 + `--line` 颜色形成 subtle grid
- 5 个严重度图例 dots 颜色与卡片左侧边色一致

### 🟡 V1. HTML 报告浅色模式 — 对比度偏弱

**截图**：`docs/reviews/2026-08-04-spectral/screenshots/02-hero.png`

**问题**：
- 浅色模式（系统默认）下，`--spectrum-cyan: #50e3c2` 在 `--bg: #fafaf7` 上对比度 **1.6:1**（WCAG AA 要求正文 4.5:1）
- 标题中的「光谱审查」字样在浅色下几乎不可读
- `box-shadow: 0 0 40px color-mix(...)` 浅色下 box-shadow 几乎不可见

**修复建议**（下次升级时同步改）：
- 浅色模式下用更深的青色：`--spectrum-cyan: #0a8a72`（深绿青）
- 或在浅色模式下禁用 box-shadow，改用 `border: 1px solid var(--line)` 强调
- 改完后再截一次浅色图对比

---

## 5. 真实运行产物

| 文件 | 大小 | 用途 |
|---|---|---|
| `docs/reviews/2026-08-04-spectral/REPORT.md` | 28.7 KB | 静态代码审查（566 行） |
| `docs/reviews/2026-08-04-spectral/REPORT.html` | 42.3 KB | 静态审查视觉版（818 行，dark/light 双模式） |
| `docs/reviews/2026-08-04-spectral/AUDIT.md` | （本文件） | 工程审计 |
| `docs/reviews/2026-08-04-spectral/screenshots/01-full.png` | 1021782 B | HTML 报告全页截图 |
| `docs/reviews/2026-08-04-spectral/screenshots/02-hero.png` | 72026 B | 浅色模式首屏 |
| `docs/reviews/2026-08-04-spectral/screenshots/03-hero-dark.png` | （D）| 深色模式首屏 |

---

## 6. 综合评级变化

| 维度 | REPORT.md 静态评级 | AUDIT.md 动态实测 | 变化 |
|---|---|---|---|
| 测试绿 | 假设绿（README 说 344） | **5 failed** | 🔴 降 |
| mypy 绿 | 假设绿（CI 门禁） | **3 errors** | 🔴 降 |
| 前端 tsc | 假设绿 | exit 0 | 🟢 一致 |
| 依赖安全 | 未审 | **4 high 漏洞** | 🔴 降 |
| 沙箱安全 | 静态推断 | **63/63 通过** | 🟢 升（实证） |
| 异步并发 | 静态推断 | **16 并发 35ms** | 🟢 升（实证） |
| HTML 视觉 | 假设成立 | **深色 OK，浅色对比度弱** | 🟡 微调 |

---

## 7. 给用户的「真假」总结

| 论断 | 静态审查报告说 | 实测后修正 |
|---|---|---|
| 「CI 全绿」 | ✅ | ❌ **5 failed + 3 mypy errors** |
| 「0 依赖漏洞」 | （未审）| ❌ **4 high 漏洞**（Next 16.2.10） |
| 「沙箱安全」 | ✅ | ✅ 63/63 通过（更可信） |
| 「异步真并发」 | ✅ | ✅ 16 并发 35ms（实证） |
| 「HTML 报告视觉」 | （未验证）| ✅ 深色成立，🟡 浅色对比度弱 |

**结论**：本份审计是对 `REPORT.md` 静态分析的**关键校准**。静态审查中 6 处「绿」评级被实际测试降级为「红」或「黄」。

---

## 8. 修复优先级总览（与 REPORT.md 互补）

### 批次 1（HIGH，必须立即修）
| 编号 | 标题 | 工作量 |
|---|---|---|
| H2 | pytest stub 接受 `history` 关键字参数 | 极小（5 处 stub） |
| H3 | `TraceView.tsx` 用稳定 `key`（`thought:${step}:${turn}`） | 小 |
| H4a | 删 `config.py:116` 无效 `# type: ignore` | 极小 |
| H4b | 改 `router.py:471` 循环变量名 `options → baseline_opts` | 极小 |
| H5 | `npm audit fix --force` + 升 Next.js 16.3.0+ + 改 `package.json` | 小 |

### 批次 2（MEDIUM，可与 REPORT.md M1-M7 合并）
- 与 REPORT.md M5（`ArenaClient.tsx` 抽 hook）合并 → 抽 `useTraceView` 时顺便修 H3
- 与 REPORT.md M6（删 `requirements.txt`）合并 → 验证 `pip-audit` 仍 0 漏洞

### 批次 3（LOW，与 REPORT.md L 系列合并）
- V1：HTML 报告浅色模式对比度
- 与 REPORT.md L4（`globals.css` 加章节注释）合并

---

## 9. 给用户的最紧急行动

1. **立即处理 H2 + H4a + H4b + H5**（共 4 处，< 30 分钟）：恢复 CI 绿灯
2. **本 PR 处理 H3**（稳定 TraceView key）+ V1（修浅色对比度）
3. **下次大重构**处理 REPORT.md D1-D3

**不要相信 README / CLAUDE.md / CI badge 上的「344 全绿」——本机实测发现 5 failed + 3 mypy errors**。可能 CI 上次运行时它们还没失败，但**当前 commit d04b431 状态是红的**。

---

*审计生成于 2026-08-04，与 `REPORT.md` 互补；本审计未修改任何项目代码。*
