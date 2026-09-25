"""AutoGen framework bootstrap for the driver-autogen Python bridge.

Reads one NDJSON handshake from stdin (question, tool catalog, budget), runs
a real autogen-agentchat RoundRobinGroupChat coder/reviewer conversation, and
streams NDJSON lines back:

- llm_request lines ask the host for one model completion (the arena model
  stays on the host side; this process never sees provider credentials)
- tool_request lines ask the host to execute one arena tool
- event lines report coder/reviewer speech as the conversation progresses
- final carries the last coder answer; error ends the session

All protocol lines are single-line JSON on stdout; anything else printed to
stdout is dropped by the host, so framework prints are harmless. Host lines
are consumed by a daemon thread: asyncio pipe readers are not portable to
Windows for stdin, while a blocking readline loop is.

Tested against autogen-agentchat 0.4/0.5/0.6 (the requirements.txt range):
- ChatCompletionClient's abstract surface differs slightly across releases,
  so the bridge client implements the union (capabilities + model_info,
  create/create_stream, count_tokens/remaining_tokens, usage, close).
- AssistantAgent hands BaseTool instances to the client on 0.4/0.5 but
  ToolSchema dicts (via the agent workbench) on 0.6; _tool_schema accepts
  both shapes.
"""

from __future__ import annotations

import asyncio
import json
import sys
import threading
from typing import Any

from pydantic import BaseModel, ConfigDict

from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.conditions import MaxMessageTermination, TextMentionTermination
from autogen_agentchat.teams import RoundRobinGroupChat
from autogen_core import FunctionCall
from autogen_core.models import (
    ChatCompletionClient,
    CreateResult,
    RequestUsage,
)
from autogen_core.tools import BaseTool

TERMINATE = "TERMINATE"
CODER_NAME = "coder"
REVIEWER_NAME = "reviewer"


class BridgeSession:
    """stdin/stdout framing: outbound lines are synchronous writes; inbound
    tool results settle futures keyed by request id from a reader thread."""

    def __init__(self) -> None:
        self._pending: dict[str, asyncio.Future[str]] = {}
        self._lock = threading.Lock()

    def send(self, payload: dict[str, Any]) -> None:
        with self._lock:
            sys.stdout.write(json.dumps(payload) + "\n")
            sys.stdout.flush()

    async def request(self, payload: dict[str, Any]) -> str:
        loop = asyncio.get_running_loop()
        future: asyncio.Future[str] = loop.create_future()
        with self._lock:
            self._pending[payload["id"]] = future
        self.send(payload)
        return await future

    def pump_thread(self, loop: asyncio.AbstractEventLoop) -> None:
        """Consumes host lines (llm_response / tool_result) and settles futures."""
        for raw in sys.stdin:
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if message.get("type") in ("tool_result", "llm_response"):
                with self._lock:
                    future = self._pending.pop(message.get("id"), None)
                if future is not None and not future.done():
                    loop.call_soon_threadsafe(
                        future.set_result,
                        str(message.get("result", "") or message.get("content", "")),
                    )


class BridgeChatCompletionClient(ChatCompletionClient):
    """ChatCompletionClient that round-trips every completion to the host.

    Implements the autogen_core model protocol over the NDJSON bridge: create
    sends the neutral messages plus the tool schemas and waits for the host's
    llm_response. Function calling rides inside the response as tool_calls.
    """

    def __init__(self, session: BridgeSession) -> None:
        self._session = session
        self._counter = 0

    @property
    def model_info(self) -> dict[str, Any]:
        # The host model is whatever the arena endpoint exposes; the group chat
        # only needs function calling, so the conservative capability set stands.
        return {
            "family": "bridge",
            "vision": False,
            "function_calling": True,
            "json_output": True,
            "structured_output": False,
            "multiple_system_messages": True,
        }

    @property
    def capabilities(self) -> dict[str, Any]:
        # Deprecated but still abstract across the pinned range.
        return {
            "vision": False,
            "function_calling": True,
            "json_output": True,
        }

    @property
    def model(self) -> str:
        return "arena-bridge"

    def count_tokens(self, messages: Any, tools: Any = None) -> int:
        # Token accounting happens host-side on the real model response.
        return 0

    def remaining_tokens(self, messages: Any, tools: Any = None) -> int:
        return 10**9

    def actual_usage(self) -> RequestUsage:
        return RequestUsage(prompt_tokens=0, completion_tokens=0)

    def total_usage(self) -> RequestUsage:
        return RequestUsage(prompt_tokens=0, completion_tokens=0)

    async def create(
        self,
        messages: Any,
        tools: Any = None,
        json_output: Any = None,
        extra_create_args: Any = None,
        cancellation_token: Any = None,
    ) -> CreateResult:
        self._counter += 1
        request_id = f"llm-{self._counter}"
        payload = await self._session.request(
            {
                "type": "llm_request",
                "id": request_id,
                "messages": [
                    item
                    for message in messages
                    for item in _neutral_messages(message)
                ],
                "tools": [_tool_schema(tool) for tool in (tools or [])],
            }
        )
        parsed = json.loads(payload) if payload else {"content": "", "toolCalls": []}
        calls = parsed.get("toolCalls") or []
        if calls:
            content = [
                FunctionCall(id=call["id"], name=call["name"], arguments=call["args"])
                for call in calls
            ]
        else:
            content = str(parsed.get("content", ""))
        return CreateResult(
            finish_reason="stop",
            content=content,
            usage=RequestUsage(prompt_tokens=0, completion_tokens=0),
            cached=False,
        )

    async def create_stream(
        self,
        messages: Any,
        tools: Any = None,
        json_output: Any = None,
        extra_create_args: Any = None,
        cancellation_token: Any = None,
    ) -> Any:
        result = await self.create(messages, tools, json_output, extra_create_args, cancellation_token)
        yield result

    async def close(self) -> None:
        return None


class _BridgeToolArgs(BaseModel):
    """Catch-all args model: raw tool arguments pass through untouched."""

    model_config = ConfigDict(extra="allow")


class BridgeTool(BaseTool):
    """One arena tool exposed to the group chat; execution round-trips to the host.

    FunctionTool cannot express a dynamic parameter schema, so the bridge
    subclasses BaseTool directly: `schema` returns the arena tool's real
    parameters and `run` forwards the received arguments as a JSON string.
    """

    def __init__(
        self,
        session: BridgeSession,
        name: str,
        description: str,
        parameters: dict[str, Any],
    ) -> None:
        self._session = session
        self._tool_name = name
        self._parameters = parameters if parameters else {"type": "object", "properties": {}}
        self._counter = 0
        super().__init__(_BridgeToolArgs, str, name, description)

    @property
    def schema(self) -> dict[str, Any]:
        return {
            "name": self._name,
            "description": self._description,
            "parameters": self._parameters,
        }

    async def run(self, args: Any, cancellation_token: Any) -> str:
        self._counter += 1
        request_id = f"tool-{self._tool_name}-{self._counter}"
        return await self._session.request(
            {
                "type": "tool_request",
                "id": request_id,
                "name": self._tool_name,
                "args": json.dumps(args.model_dump()),
            }
        )


def _neutral_messages(message: Any) -> list[dict[str, Any]]:
    """Projects one autogen LLMMessage into the bridge's neutral shape.

    A FunctionExecutionResultMessage with N results expands to N tool messages
    so every parallel tool output reaches the model (checked before the generic
    list-content branch: the result message's content is also a list).
    """
    kind = getattr(message, "type", None)
    content = message.content
    if kind == "FunctionExecutionResultMessage":
        return [
            {
                "role": "tool",
                "content": str(getattr(result, "content", "")),
                "toolCallId": str(getattr(result, "call_id", "")),
                "name": str(getattr(result, "name", "") or ""),
            }
            for result in content
        ]
    if isinstance(content, list):
        # AssistantMessage carrying FunctionCall entries.
        calls = [
            {"id": call.id, "name": call.name, "args": call.arguments}
            for call in content
            if getattr(call, "name", None) is not None
        ]
        return [{"role": "assistant", "content": "", "toolCalls": calls}]
    source = getattr(message, "source", "")
    if kind == "SystemMessage":
        return [{"role": "system", "content": str(content)}]
    if source in (CODER_NAME, REVIEWER_NAME) or kind == "AssistantMessage":
        return [{"role": "assistant", "content": str(content)}]
    return [{"role": "user", "content": str(content)}]


def _tool_schema(tool: Any) -> dict[str, Any]:
    """Projects an autogen tool (BaseTool instance or ToolSchema dict) into
    the bridge's neutral shape. AssistantAgent hands BaseTool instances to the
    client on 0.4/0.5 and ToolSchema dicts (from the agent workbench) on 0.6."""
    schema = tool if isinstance(tool, dict) else getattr(tool, "schema", None) or {}
    return {
        "name": str(schema.get("name", "")),
        "description": str(schema.get("description", "")),
        "parameters": schema.get("parameters") or {"type": "object", "properties": {}},
    }


async def main() -> None:
    session = BridgeSession()
    start_raw = sys.stdin.readline()
    if not start_raw:
        return
    start = json.loads(start_raw)
    question = str(start.get("question", ""))

    loop = asyncio.get_running_loop()
    reader = threading.Thread(target=session.pump_thread, args=(loop,), daemon=True)
    reader.start()

    client = BridgeChatCompletionClient(session)
    remote_tools = [
        BridgeTool(session, str(tool["name"]), str(tool["description"]), tool.get("parameters") or {})
        for tool in start.get("tools", [])
    ]
    coder = AssistantAgent(
        CODER_NAME,
        system_message=(
            "[AutoGen coder] You are the coding assistant. Make progress with tool calls; "
            "when the task is complete, reply with the final answer stating artifact paths and how to run them."
        ),
        model_client=client,
        tools=remote_tools,
    )
    reviewer = AssistantAgent(
        REVIEWER_NAME,
        system_message=(
            f"[AutoGen reviewer] Review the transcript. If the task is complete, start your reply with {TERMINATE} "
            "and add a one-line verdict. Otherwise give the single most important next step."
        ),
        model_client=client,
    )
    team = RoundRobinGroupChat(
        [coder, reviewer],
        termination_condition=TextMentionTermination(TERMINATE)
        | MaxMessageTermination(max_messages=int(start.get("maxSteps", 8)) * 2 + 2),
    )

    last_coder = ""
    last_reviewer = ""
    try:
        # No cancellation token: abort is a host-side process kill.
        async for message in team.run_stream(task=question):
            source = getattr(message, "source", "")
            content = getattr(message, "content", "")
            if source in (CODER_NAME, REVIEWER_NAME) and isinstance(content, str) and content:
                session.send({"type": "event", "kind": "assistant", "speaker": source, "content": content})
                if source == CODER_NAME:
                    last_coder = content
                else:
                    last_reviewer = content
    except Exception as error:  # noqa: BLE001 - the failure must cross the bridge
        session.send({"type": "error", "message": f"{type(error).__name__}: {error}"})
        return

    answer = last_coder.strip()
    if answer == "" and last_reviewer.strip() != "":
        # The coder's last turn was tool calls, so the terminating verdict is
        # the only answer the chat produced — mirror it onto the coder channel
        # or the run ends with success but no answer (same rule the TypeScript
        # pattern fallback applies).
        session.send({"type": "event", "kind": "assistant", "speaker": CODER_NAME, "content": last_reviewer})
        answer = last_reviewer.strip()
    session.send({"type": "final", "answer": answer})


if __name__ == "__main__":
    asyncio.run(main())
