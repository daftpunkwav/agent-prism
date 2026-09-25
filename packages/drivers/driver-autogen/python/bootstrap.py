"""AutoGen framework bootstrap for the driver-autogen Python bridge.

Reads one NDJSON handshake from stdin (question, history, tool catalog,
budget, locale), runs a real autogen-agentchat RoundRobinGroupChat coder/
reviewer conversation, and streams NDJSON lines back:

- llm_request lines ask the host for one model completion (the arena model
  stays on the host side; this process never sees provider credentials)
- tool_request lines ask the host to execute one arena tool
- event lines report coder/reviewer speech as the conversation progresses
- final carries the last coder answer; error ends the session

All protocol lines are single-line JSON on stdout; anything else printed to
stdout is dropped by the host, so framework prints are harmless. Host lines
are consumed by a daemon thread: asyncio pipe readers are not portable to
Windows for stdin, while a blocking readline loop is.
"""

from __future__ import annotations

import asyncio
import json
import sys
import threading
from typing import Any

from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.conditions import MaxMessageTermination, TextMentionTermination
from autogen_agentchat.teams import RoundRobinGroupChat
from autogen_core import CancellationToken
from autogen_core.models import ChatCompletionClient, CreateResult, FunctionCall, RequestUsage

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
                future = self._pending.pop(message.get("id"), None)
                if future is not None and not future.done():
                    loop.call_soon_threadsafe(future.set_result, str(message.get("result", "") or message.get("content", "")))


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
    def model(self) -> str:
        return "arena-bridge"

    def count_tokens(self, messages: Any, tools: Any = None) -> int:
        # Token accounting happens host-side on the real model response.
        return 0

    def remaining_tokens(self, messages: Any, tools: Any = None) -> int:
        return 10**9

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
                "messages": [_neutral_message(message) for message in messages],
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


def _neutral_message(message: Any) -> dict[str, Any]:
    """Projects an autogen LLMMessage into the bridge's neutral shape."""
    kind = getattr(message, "type", None)
    content = message.content
    if isinstance(content, list):
        # AssistantMessage carrying FunctionCall entries.
        calls = [
            {"id": call.id, "name": call.name, "args": call.arguments}
            for call in content
            if getattr(call, "name", None) is not None
        ]
        return {"role": "assistant", "content": "", "toolCalls": calls}
    source = getattr(message, "source", "")
    if kind == "SystemMessage":
        return {"role": "system", "content": str(content)}
    if kind == "FunctionExecutionResultMessage":
        results = getattr(message, "content", [])
        payload: dict[str, Any] = {"role": "tool", "content": ""}
        if results:
            first = results[0]
            payload["content"] = str(getattr(first, "content", ""))
            payload["toolCallId"] = str(getattr(first, "call_id", ""))
            payload["name"] = str(getattr(first, "name", "") or "")
        return payload
    if source in (CODER_NAME, REVIEWER_NAME) or kind == "AssistantMessage":
        return {"role": "assistant", "content": str(content)}
    return {"role": "user", "content": str(content)}


def _tool_schema(tool: Any) -> dict[str, Any]:
    """Projects an autogen Tool schema into the bridge's neutral shape."""
    schema = getattr(tool, "schema", None) or {}
    return {
        "name": str(schema.get("name") or getattr(tool, "name", "")),
        "description": str(schema.get("description") or getattr(tool, "description", "")),
        "parameters": schema.get("parameters") or {"type": "object", "properties": {}},
    }


def _remote_tool(session: BridgeSession, name: str, description: str, parameters: dict[str, Any]) -> Any:
    """Builds an autogen function tool whose body round-trips to the host."""
    from autogen_core.tools import FunctionTool

    async def _call(**kwargs: Any) -> str:
        request_id = f"tool-{name}-{id(kwargs) % 10**8}"
        return await session.request(
            {"type": "tool_request", "id": request_id, "name": name, "args": json.dumps(kwargs)}
        )

    return FunctionTool(
        name=name,
        description=description,
        func=_call,
        parameters=parameters if parameters else {"type": "object", "properties": {}},
    )


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
        _remote_tool(session, tool["name"], tool["description"], tool["parameters"])
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
    try:
        async for message in team.run_stream(task=question, cancellation_token=CancellationToken.default()):
            source = getattr(message, "source", "")
            content = getattr(message, "content", "")
            if source in (CODER_NAME, REVIEWER_NAME) and isinstance(content, str) and content:
                session.send({"type": "event", "kind": "assistant", "speaker": source, "content": content})
                if source == CODER_NAME:
                    last_coder = content
    except Exception as error:  # noqa: BLE001 - the failure must cross the bridge
        session.send({"type": "error", "message": f"{type(error).__name__}: {error}"})
        return

    session.send({"type": "final", "answer": last_coder.strip()})


if __name__ == "__main__":
    asyncio.run(main())
