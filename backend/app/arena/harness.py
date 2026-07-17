"""Harness 引擎 — 真实验证/反思/自进化循环。"""

from __future__ import annotations

import json
import logging
import re

from langchain_core.messages import HumanMessage, SystemMessage

from app.arena.llm import create_chat_model
from app.arena.types import HarnessLevel

logger = logging.getLogger(__name__)

__all__ = [
    "HarnessLevel",
    "verify_result",
    "reflect_on_failure",
    "propose_harness_edit",
    "HarnessRunner",
    "apply_harness_level",
    "get_harness_description",
]

# 去除 LLM 输出中常见的 ```json ... ``` 或 ``` ... ``` 代码块包裹
_JSON_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)

# 提示注入模式：检测 LLM 是否试图篡改系统指令
_INJECTION_PATTERNS = re.compile(
    r"(?i)(ignore\s+(all\s+)?previous\s+instructions?|"
    r"you\s+are\s+now\s+|"
    r"disregard\s+|"
    r"override\s+(your\s+)?(system\s+)?(prompt|instructions?)|"
    r"new\s+instructions?\s*:)"
)


def _strip_json_fence(text: str) -> str:
    """去除 LLM 返回的 markdown code fence，便于后续 json.loads 解析。"""
    return _JSON_FENCE.sub("", text).strip()


def _sanitize_for_json(text: str) -> str:
    """清理 LLM 输出中可能的提示注入内容，保留有效 JSON。"""
    # 移除 JSON 外的注入文本
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return _strip_json_fence(match.group())
    return _strip_json_fence(text)


def _detect_injection(text: str) -> bool:
    """检测文本中是否包含提示注入模式。"""
    return bool(_INJECTION_PATTERNS.search(text))


# ===== 验证器 =====


def verify_result(
    question: str,
    answer: str,
    tool_calls: int,
    model=None,
) -> tuple[bool, str]:
    """验证 LLM 输出质量。返回 (是否通过, 原因)。"""
    # 检测提示注入
    if _detect_injection(answer):
        return False, "检测到可能的提示注入"

    llm = model or create_chat_model()
    prompt = [
        SystemMessage(
            content="""你是答案质量验证器。评估以下回答是否准确、完整地回答了用户问题。

判断标准：
1. 是否直接回答了问题
2. 是否有事实错误
3. 是否遗漏关键信息

输出 JSON：{"passed": true/false, "reason": "..."}"""
        ),
        HumanMessage(content=f"问题：{question}\n\n回答：{answer[:2000]}\n\n工具调用次数：{tool_calls}"),
    ]
    try:
        response = llm.invoke(prompt)
        cleaned = _sanitize_for_json(response.content)
        result = json.loads(cleaned)
        return result.get("passed", False), result.get("reason", "无法解析验证结果")
    except Exception:
        # 验证器自身故障时不得静默放行，避免削弱 Harness 对比意义
        return False, "验证解析失败，视为未通过"


# ===== 反思器 =====


def reflect_on_failure(
    question: str,
    answer: str,
    verification_reason: str,
    model=None,
) -> str:
    """反思失败原因，生成改进建议。"""
    llm = model or create_chat_model()
    prompt = [
        SystemMessage(
            content="""你是 Agent 性能反思器。分析为什么回答没有通过验证，提出具体的改进策略。

输出格式（JSON）：
{"insight": "...", "strategy": "...", "prompt_adjustment": "..."}"""
        ),
        HumanMessage(content=f"问题：{question}\n\n回答：{answer[:2000]}\n\n验证未通过原因：{verification_reason}"),
    ]
    try:
        response = llm.invoke(prompt)
        cleaned = _sanitize_for_json(response.content)
        result = json.loads(cleaned)
        return result.get("strategy", result.get("insight", "继续尝试"))
    except Exception:
        return "反思解析失败，使用原始策略重试"


# ===== 自进化 =====


def propose_harness_edit(
    question: str,
    answer: str,
    reflection: str,
    current_prompt: str,
    model=None,
) -> dict:
    """提出 Harness 配置修改建议。"""
    llm = model or create_chat_model()
    prompt = [
        SystemMessage(
            content="""你是 Harness 自进化引擎。基于反思结果，提出具体的 Harness 配置修改。

可修改项：system prompt 补充、温度调整建议、工具选择建议。

输出 JSON：
{"prompt_additions": ["..."], "temperature_suggestion": 0.0, "tools_to_add": ["..."], "reasoning": "..."}"""
        ),
        HumanMessage(content=f"问题：{question}\n\n当前 system prompt：{current_prompt[:500]}\n\n反思：{reflection}"),
    ]
    try:
        response = llm.invoke(prompt)
        cleaned = _sanitize_for_json(response.content)
        return json.loads(cleaned)
    except Exception:
        return {"prompt_additions": [], "reasoning": "自进化解析失败"}


# ===== Harness 循环执行器 =====


def _normalize_content(content: object) -> str:
    """将消息 content 规范为字符串。"""
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict):
                parts.append(str(block.get("thinking") or block.get("text") or block))
            else:
                parts.append(str(block))
        return " ".join(parts)
    return str(content) if content is not None else ""


def _extract_answer_and_tool_calls(state: dict) -> tuple[str, int, list]:
    """从图最终状态提取答案文本、工具调用次数与 messages。"""
    messages = state.get("messages") or []
    tool_calls = int(state.get("tool_calls") or 0)
    if not messages:
        return "", tool_calls, messages
    last_msg = messages[-1]
    answer = _normalize_content(getattr(last_msg, "content", str(last_msg)))
    return answer[:2000], tool_calls, messages


def _pick_final_state(event: dict, current: dict | None) -> dict | None:
    """从 astream_events 中挑选更完整的图输出状态。"""
    if event.get("event") != "on_chain_end":
        return current
    data = event.get("data") or {}
    out = data.get("output")
    if not isinstance(out, dict):
        return current
    # 优先保留带 messages 的状态
    if "messages" in out:
        return out
    if current is None:
        return out
    return current


class HarnessRunner:
    """根据 Harness 级别包装图执行，并通过 stream_events 接入适配器主路径。"""

    def __init__(self, level: HarnessLevel = "bare"):
        self.level = level
        # bare 只跑 1 次；其余级别默认最多 2 次（含首次）
        self.max_retries = {"bare": 1, "verify": 2, "reflect": 2, "self_evolve": 2}.get(level, 1)
        self.attempts = 0
        self.reflections: list[str] = []
        self.harness_edits: list[dict] = []
        self.final_state: dict = {}

    async def stream_events(self, question: str, graph, initial_state: dict):
        """流式产出图事件与 Harness 控制事件。

        - 普通 LangGraph astream_events 字典原样 yield
        - Harness 事件带 ``_harness: True``，字段含 type/passed/content 等
        """
        if self.level == "bare":
            final_state: dict | None = None
            async for event in graph.astream_events(initial_state, version="v2"):
                final_state = _pick_final_state(event, final_state)
                yield event
            self.final_state = final_state or {}
            self.attempts = 1
            return

        state = dict(initial_state)
        # 保留原始 system / human，便于重试时重建
        base_messages = list(initial_state.get("messages") or [])

        while self.attempts < self.max_retries:
            self.attempts += 1
            final_state = None
            async for event in graph.astream_events(state, version="v2"):
                final_state = _pick_final_state(event, final_state)
                yield event

            self.final_state = final_state or {}
            answer, tool_calls, messages = _extract_answer_and_tool_calls(self.final_state)
            if not answer and not messages:
                yield {
                    "_harness": True,
                    "type": "verify",
                    "passed": False,
                    "content": f"[{self.level}] 验证 #{self.attempts}: 无有效输出",
                }
                break

            passed, reason = verify_result(question, answer, tool_calls)
            yield {
                "_harness": True,
                "type": "verify",
                "passed": passed,
                "content": f"[{self.level}] 验证 #{self.attempts}: {reason}",
            }

            if passed or self.attempts >= self.max_retries:
                break

            # verify：直接重跑，不改 prompt
            if self.level == "verify":
                state = {
                    **dict(initial_state),
                    "messages": list(base_messages),
                    "step_count": 0,
                    "tool_calls": 0,
                    "reflections": list(state.get("reflections") or []),
                }
                continue

            # reflect / self_evolve：反思后带着策略重试
            insight = reflect_on_failure(question, answer, reason)
            self.reflections.append(insight)
            yield {
                "_harness": True,
                "type": "reflect",
                "passed": None,
                "content": f"[反思 #{self.attempts}] {insight}",
            }

            system_msg = ""
            human_msgs: list = []
            for m in base_messages:
                if isinstance(m, SystemMessage):
                    system_msg = m.content if isinstance(m.content, str) else _normalize_content(m.content)
                elif isinstance(m, HumanMessage):
                    human_msgs.append(m)

            if self.level == "self_evolve":
                edit = propose_harness_edit(question, answer, insight, system_msg)
                self.harness_edits.append(edit)
                yield {
                    "_harness": True,
                    "type": "harness_edit",
                    "passed": None,
                    "content": f"[自进化 #{self.attempts}] {json.dumps(edit, ensure_ascii=False)[:300]}",
                }
                if edit.get("prompt_additions"):
                    additions = " ".join(str(a) for a in edit["prompt_additions"])
                    system_msg = system_msg + f"\n\n[Harness 自进化 #{self.attempts}]\n{additions}"

            # 将反思策略注入 system，下一轮重新开跑
            system_msg = system_msg + f"\n\n[上一轮反思]\n{insight}"
            state = {
                **dict(initial_state),
                "messages": [SystemMessage(content=system_msg), *human_msgs],
                "step_count": 0,
                "tool_calls": 0,
                "reflections": list(self.reflections),
            }

    async def execute(self, question: str, graph, initial_state: dict, emitter_callback) -> dict:
        """兼容旧接口：通过 callback 转发事件，返回最终状态。"""
        async for event in self.stream_events(question, graph, initial_state):
            maybe = emitter_callback(event)
            if hasattr(maybe, "__await__"):
                await maybe
        return self.final_state


def apply_harness_level(
    base_system: str,
    base_user: str,
    level: HarnessLevel,
) -> tuple[str, str]:
    """根据 Harness 级别调整 system 和 user prompt（保持兼容）。"""
    if level == "verify":
        suffix = "\n\n执行后验证：检查答案是否准确回答了问题，格式是否正确。"
    elif level == "reflect":
        suffix = "\n\n执行 → 评估 → 反思：完成后分析结果质量，反思哪里可以改进。"
    elif level == "self_evolve":
        suffix = "\n\n执行 → 评估 → 反思 → 自进化：分析本次执行的弱点，提出改进建议。"
    else:
        suffix = ""
    return base_system + suffix, base_user


def get_harness_description(level: HarnessLevel) -> str:
    descriptions = {
        "bare": "裸运行：LLM 输出即结果，无验证",
        "verify": "验证循环：检查答案质量，不通过则重试",
        "reflect": "反思循环：验证 + 反思改进",
        "self_evolve": "自进化：反思 + 提出自身改进方案",
    }
    return descriptions.get(level, "")
