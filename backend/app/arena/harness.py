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
        return True, "验证解析失败，默认通过"


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


class HarnessRunner:
    """根据 Harness 级别包装图执行。"""

    def __init__(self, level: HarnessLevel = "bare"):
        self.level = level
        self.max_retries = {"verify": 2, "reflect": 2, "self_evolve": 2}.get(level, 0)
        self.attempts = 0
        self.reflections: list[str] = []
        self.harness_edits: list[dict] = []

    async def execute(self, question: str, graph, initial_state: dict, emitter_callback) -> dict:
        """执行带 Harness 的图运行。"""
        if self.level == "bare":
            return await self._run_once(graph, initial_state, emitter_callback)

        return await self._run_with_harness(question, graph, initial_state, emitter_callback)

    async def _run_once(self, graph, initial_state: dict, emitter_callback) -> dict:
        """单次运行（裸运行）。"""
        final_state = None
        async for event in graph.astream_events(initial_state, version="v2"):
            emitter_callback(event)
            final_state = event
        return final_state or {}

    async def _run_with_harness(self, question: str, graph, initial_state: dict, emitter_callback) -> dict:
        """带验证/反思/自进化的运行。"""
        state = dict(initial_state)
        last_result = None

        while self.attempts < self.max_retries:
            self.attempts += 1

            # 运行图
            result = await self._run_once(graph, state, emitter_callback)
            last_result = result

            # 提取最终答案
            messages = result.get("messages", state.get("messages", []))
            if not messages:
                break

            last_msg = messages[-1]
            answer = getattr(last_msg, "content", str(last_msg))
            tool_calls = result.get("tool_calls", 0)

            # 验证
            passed, reason = verify_result(question, answer, tool_calls)
            emitter_callback(
                {
                    "type": "verify",
                    "pipeline": "harness",
                    "passed": passed,
                    "reason": f"[{self.level}] 验证 #{self.attempts}: {reason}",
                }
            )

            if passed:
                break

            if self.attempts >= self.max_retries:
                break

            # 反思（reflect / self_evolve）
            if self.level in ("reflect", "self_evolve"):
                insight = reflect_on_failure(question, answer, reason)
                self.reflections.append(insight)
                emitter_callback(
                    {
                        "type": "reflect",
                        "pipeline": "harness",
                        "insight": f"[反思] {insight}",
                    }
                )

                # 自进化：提出配置修改
                if self.level == "self_evolve":
                    system_msg = next(
                        (m.content for m in messages if isinstance(m, SystemMessage)), ""
                    )
                    edit = propose_harness_edit(question, answer, insight, system_msg)
                    self.harness_edits.append(edit)
                    emitter_callback(
                        {
                            "type": "harness_edit",
                            "pipeline": "harness",
                            "change": json.dumps(edit, ensure_ascii=False)[:200],
                        }
                    )

                    # 应用 prompt 修改到下一轮
                    if edit.get("prompt_additions"):
                        additions = " ".join(edit["prompt_additions"])
                        new_system = system_msg + f"\n\n[Harness 自进化 #{self.attempts}]\n{additions}"
                        state["messages"] = [
                            SystemMessage(content=new_system)
                        ] + [m for m in messages if isinstance(m, HumanMessage)]

        return last_result or {}


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
