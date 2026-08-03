"""前端关键契约的静态回归（无需浏览器）。

覆盖本次修复：
- saveProvider 仅省略空 api_key
- TraceView thought 稳定 key 逻辑（用纯函数复刻）
- ArenaEvent.workspace 字段存在于 api.ts
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API_TS = ROOT / "frontend" / "src" / "lib" / "api.ts"
TRACE_VIEW = ROOT / "frontend" / "src" / "components" / "TraceView.tsx"
ARENA_CLIENT = ROOT / "frontend" / "src" / "app" / "arena" / "ArenaClient.tsx"


def test_save_provider_only_omits_empty_api_key():
    src = API_TS.read_text(encoding="utf-8")
    assert "delete payload.api_key" in src
    # 不得再无条件解构丢弃 api_key
    assert "const { api_key: _ak, ...rest }" not in src
    assert "typeof key !== \"string\" || !key.trim()" in src or "!.trim()" in src or "key.trim()" in src


def test_arena_event_has_workspace_field():
    src = API_TS.read_text(encoding="utf-8")
    assert "workspace?" in src or "workspace:" in src
    assert "export async function createProject" in src


def test_traceview_uses_stable_thought_key():
    src = TRACE_VIEW.read_text(encoding="utf-8")
    assert "thought:${step}" in src or "thought:`" in src or 'thought:${step}' in src
    # delta 与 end 都应使用 thoughtKey
    assert src.count("thoughtKey") >= 3
    # thinking 与最终答案分离
    assert 'ev.type === "thinking"' in src or "ev.type === 'thinking'" in src
    assert "内心推理" in src


def test_arena_client_save_project_and_real_workspace():
    src = ARENA_CLIENT.read_text(encoding="utf-8")
    assert "createProject" in src
    assert "saveAsProject" in src
    assert "创建项目" in src
    # 不得再猜测 label_ 前缀
    assert "${completed.label}_" not in src
    assert "${first.label}_" not in src
    assert "c.workspace" in src or "col.workspace" in src


def test_arena_client_has_baseline_controls():
    src = ARENA_CLIENT.read_text(encoding="utf-8")
    assert "控制变量基线" in src
    assert "baselinePayload" in src
    assert "baseline_fields" in src
    api = API_TS.read_text(encoding="utf-8")
    assert "BaselineOverrides" in api
    assert "body.baseline" in api


def test_thought_merge_key_contract():
    """纯逻辑：thought_delta 与 thought_end 必须共享同一 key。"""

    def thought_key(ev_type: str, step: int) -> str:
        if ev_type in ("thought", "thought_delta", "thought_end"):
            return f"thought:{step}"
        return f"{ev_type}:{step}"

    assert thought_key("thought_delta", 3) == thought_key("thought_end", 3)
    assert thought_key("thought_delta", 3) != thought_key("action", 3)


def test_templates_and_judge_contract():
    """任务模板库前端契约：api.ts 必须暴露 fetchTemplates / judgeAnswers / TaskTemplate / JudgeResult。"""
    src = API_TS.read_text(encoding="utf-8")
    assert "export interface TaskTemplate" in src
    assert "export interface JudgeResult" in src
    assert "export async function fetchTemplates" in src
    assert "export async function judgeAnswers" in src
    assert "template_id" in src
    assert "suggested_dimension" in src


def test_arena_client_judge_integration():
    """ArenaClient 集成判分：提取答案 → judgeAnswers → 显示徽章。"""
    src = ARENA_CLIENT.read_text(encoding="utf-8")
    assert "judgeAnswers" in src
    assert "extractFinalAnswer" in src
    assert "judge" in src
    assert "判分通过" in src
    assert "判分未通过" in src
    assert "JUDGE_TYPE_LABEL" in src


def test_learn_page_and_url_prefill_contract():
    """学习路径契约：/learn 页面存在；ArenaClient 支持 URL 参数预填。"""
    learn_page = ROOT / "frontend" / "src" / "app" / "learn" / "page.tsx"
    assert learn_page.exists()
    learn_src = learn_page.read_text(encoding="utf-8")
    assert "WEEK_PLAN" in learn_src
    assert "开始这一步" in learn_src
    # AppShell 导航包含学习路径
    shell = ROOT / "frontend" / "src" / "components" / "AppShell.tsx"
    shell_src = shell.read_text(encoding="utf-8")
    assert '"/learn"' in shell_src
    # ArenaClient 使用 useSearchParams 做 URL 预填
    assert "useSearchParams" in ARENA_CLIENT.read_text(encoding="utf-8")
    assert 'searchParams.get("template")' in ARENA_CLIENT.read_text(encoding="utf-8")
    assert 'searchParams.get("q")' in ARENA_CLIENT.read_text(encoding="utf-8")
