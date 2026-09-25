"""CrewAI framework bootstrap for the driver-crewai Python bridge.

Reads one NDJSON handshake from stdin (question, tool catalog), runs a real
crewai Crew over the arena model, and streams NDJSON lines back:

- llm_request lines ask the host for one model completion (the arena model
  stays on the host side; this process never sees provider credentials)
- tool_request lines ask the host to execute one arena tool
- event lines report role speech as the crew progresses
- final carries the crew output; error ends the session

The process honours the ARENA_CREWAI_PROCESS knob (sequential default,
hierarchical = manager delegation) exactly like the TypeScript pattern
fallback; the step budget itself is enforced host-side in the bridge. crewai
drives everything synchronously, so the bridge is a plain threading design: a
daemon reader thread settles concurrent.futures futures while the crew blocks
the main thread. All protocol lines are single-line JSON on stdout.

Tested against crewai source 0.114-1.x (the requirements.txt range): the
bridge LLM subclasses crewai.llms.base_llm.BaseLLM, the custom-LLM seam
crewai has provided since 0.114 — earlier releases lack the module, and 1.x
rejects non-BaseLLM objects at Agent construction (the llm field validates
`str | BaseLLM | None` and the executor isinstance-checks it).
"""

from __future__ import annotations

import itertools
import json
import os
import sys
import threading
from concurrent.futures import Future
from typing import Any

from crewai import Agent, Crew, Process, Task
from crewai.llms.base_llm import BaseLLM
from crewai.tools import BaseTool

TERMINATE = "CREW_COMPLETE"
CODER_NAME = "coder"
RESEARCHER_NAME = "researcher"
REVIEWER_NAME = "reviewer"


class BridgeSession:
    """stdin/stdout framing: outbound writes are synchronous; inbound
    responses settle concurrent futures keyed by request id. Safe across
    the reader thread and the kickoff thread."""

    def __init__(self) -> None:
        self._pending: dict[str, Future[str]] = {}
        self._lock = threading.Lock()

    def send(self, payload: dict[str, Any]) -> None:
        with self._lock:
            sys.stdout.write(json.dumps(payload) + "\n")
            sys.stdout.flush()

    def request(self, payload: dict[str, Any]) -> str:
        future: Future[str] = Future()
        with self._lock:
            self._pending[payload["id"]] = future
        self.send(payload)
        return future.result(timeout=600)

    def pump_thread(self) -> None:
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
                    future.set_result(str(message.get("result", "") or message.get("content", "")))


class BridgeLLM(BaseLLM):
    """crewai BaseLLM that round-trips every completion to the host.

    Subclassing BaseLLM (not duck typing) is required: crewai's Agent llm
    field only accepts `str | BaseLLM` and the executor isinstance-checks it.
    BaseLLM.__init__(model=...) covers both the plain-ABC releases (0.114 to
    0.203) and the pydantic-model releases (1.x). crewai calls `call(...)` for
    every agent step; the neutral messages cross the bridge and the completion
    text comes back. crewai's own ReAct-style protocol handles function
    calling (supports_function_calling() is False), so only tool names and
    descriptions cross the bridge here.
    """

    def __init__(self, session: BridgeSession, model: str = "arena-bridge") -> None:
        super().__init__(model=model)
        self._session = session
        self._counter = 0

    def call(
        self,
        messages: Any,
        tools: Any = None,
        callbacks: Any = None,
        available_functions: Any = None,
        **kwargs: Any,
    ) -> str:
        self._counter += 1
        request_id = f"llm-{self._counter}"
        return self._session.request(
            {
                "type": "llm_request",
                "id": request_id,
                "messages": [_neutral_message(message) for message in messages],
                "tools": [
                    {"name": str(name), "description": str((fn or {}).get("description", ""))}
                    for name, fn in (available_functions or {}).items()
                ],
            }
        )

    def supports_function_calling(self) -> bool:
        # The ReAct-style text protocol on the crewai side owns tool calls;
        # the host model's own toolCalls never reach this process.
        return False

    def supports_stop_words(self) -> bool:
        return False


def _neutral_message(message: Any) -> dict[str, Any]:
    """Projects a crewai message (OpenAI-style dict) into the neutral shape."""
    if isinstance(message, dict):
        role = str(message.get("role", "user"))
        content = message.get("content", "")
        return {"role": role, "content": str(content or "")}
    return {"role": "user", "content": str(message)}


def _remote_tools(session: BridgeSession, specs: list[dict[str, Any]]) -> list[Any]:
    """Builds crewai BaseTool objects whose execution round-trips to the host.

    The class lives inside the factory so `_run` closes over the session —
    BaseTool is a pydantic model, so arbitrary instance attributes are not an
    option. The `_run(argument: str)` signature is the crewai-visible schema:
    the crew passes the arena tool's argument object as one JSON string, which
    the host parses. The description states that contract explicitly — without
    it the crew sees the arena tool's parameter names but an `argument`-string
    schema and sends raw objects, executing the tool with no args.
    """
    request_counter = itertools.count(1)

    class ArenaBridgeTool(BaseTool):
        """One arena tool exposed to the crew; args travel as a JSON string."""

        name: str = ""
        description: str = ""
        tool_name: str = ""

        def _run(self, argument: str = "") -> str:
            return session.request(
                {
                    "type": "tool_request",
                    "id": f"tool-{self.tool_name}-{next(request_counter)}",
                    "name": self.tool_name,
                    "args": argument,
                }
            )

    tools: list[Any] = []
    for spec in specs:
        name = str(spec["name"])
        description = str(spec["description"]) or "arena tool"
        properties = (spec.get("parameters") or {}).get("properties") or {}
        if properties:
            description += (
                " Pass the whole argument object as a single JSON string in the `argument` field."
            )
        tools.append(ArenaBridgeTool(name=name, description=description, tool_name=name))
    return tools


def main() -> None:
    session = BridgeSession()
    start_raw = sys.stdin.readline()
    if not start_raw:
        return
    start = json.loads(start_raw)
    question = str(start.get("question", ""))

    reader = threading.Thread(target=session.pump_thread, daemon=True)
    reader.start()

    llm = BridgeLLM(session)
    tools = _remote_tools(session, start.get("tools", []))

    def agent(role: str, goal: str, backstory: str, with_tools: bool) -> Agent:
        return Agent(
            role=role,
            goal=goal,
            backstory=backstory,
            llm=llm,
            tools=tools if with_tools else [],
            allow_delegation=False,
            verbose=False,
        )

    researcher = agent(
        RESEARCHER_NAME,
        "Gather the context the task needs",
        "A meticulous reader who summarizes what exists before anything changes.",
        with_tools=True,
    )
    coder = agent(
        CODER_NAME,
        "Implement the task with real tool calls",
        "A pragmatic engineer who edits files and verifies by running them.",
        with_tools=True,
    )
    reviewer = agent(
        REVIEWER_NAME,
        "Verify the work and summarize the final answer",
        "A skeptical reviewer who checks the result and states artifacts and how to run them.",
        with_tools=False,
    )

    def report(role: str) -> Any:
        def _callback(output: Any) -> None:
            session.send(
                {"type": "event", "kind": "assistant", "speaker": role, "content": str(getattr(output, "raw", output))}
            )

        return _callback

    process = (
        Process.hierarchical
        if os.environ.get("ARENA_CREWAI_PROCESS") == "hierarchical"
        else Process.sequential
    )
    tasks = [
        Task(
            description="Investigate the workspace and gather what the task needs.",
            expected_output="A short brief: relevant files, constraints, and the plan.",
            agent=researcher,
            callback=report(RESEARCHER_NAME),
        ),
        Task(
            description=f"Implement the task end to end. Task: {question}",
            expected_output="Working artifacts for the task.",
            agent=coder,
            callback=report(CODER_NAME),
        ),
        Task(
            description="Verify the artifacts and produce the final answer.",
            expected_output="The final answer: what was done, artifact paths, how to run them.",
            agent=reviewer,
            callback=report(REVIEWER_NAME),
        ),
    ]

    crew = Crew(
        agents=[researcher, coder, reviewer],
        tasks=tasks,
        process=process,
        verbose=False,
        manager_llm=llm if process == Process.hierarchical else None,
    )

    try:
        result = crew.kickoff()
        answer = str(getattr(result, "raw", result) or "")
    except Exception as error:  # noqa: BLE001 - the failure must cross the bridge
        session.send({"type": "error", "message": f"{type(error).__name__}: {error}"})
        return

    session.send({"type": "final", "answer": answer.strip()})


if __name__ == "__main__":
    main()
