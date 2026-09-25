"""CrewAI framework bootstrap for the driver-crewai Python bridge.

Reads one NDJSON handshake from stdin (question, history, tool catalog,
budget, locale), runs a real crewai Crew over the arena model, and streams
NDJSON lines back:

- llm_request lines ask the host for one model completion (the arena model
  stays on the host side; this process never sees provider credentials)
- tool_request lines ask the host to execute one arena tool
- event lines report role speech as the crew progresses
- final carries the crew output; error ends the session

The process honours the ARENA_CREWAI_PROCESS knob (sequential default,
hierarchical = manager delegation) exactly like the TypeScript pattern
fallback. crewai drives everything synchronously, so the bridge is a plain
threading design: a daemon reader thread settles concurrent.futures futures
while the crew blocks the main thread. All protocol lines are single-line
JSON on stdout.
"""

from __future__ import annotations

import json
import os
import sys
import threading
from concurrent.futures import Future
from typing import Any

from crewai import Agent, Crew, Process, Task

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
                future = self._pending.pop(message.get("id"), None)
                if future is not None and not future.done():
                    future.set_result(str(message.get("result", "") or message.get("content", "")))


class BridgeLLM:
    """Duck-typed crewai LLM: round-trips every completion to the host.

    crewai calls `call(messages, tools, callbacks, available_functions)` for
    every agent step; the neutral messages cross the bridge and the completion
    text comes back. crewai's own ReAct-style protocol handles function
    calling, so only names and descriptions cross the bridge here.
    """

    def __init__(self, session: BridgeSession, model: str = "arena-bridge") -> None:
        self._session = session
        self._counter = 0
        self.model = model

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
    """Builds crewai Tool objects whose run round-trips to the host."""
    from crewai.tools import BaseTool

    class ArenaBridgeTool(BaseTool):
        """One arena tool exposed to the crew; args travel as a JSON string."""

        name: str = ""
        description: str = ""
        tool_name: str = ""

        def _run(self, argument: str = "") -> str:
            request_id = f"tool-{self.tool_name}-{id(argument) % 10**8}"
            return session.request(
                {"type": "tool_request", "id": request_id, "name": self.tool_name, "args": argument}
            )

    tools: list[Any] = []
    for spec in specs:
        tools.append(
            ArenaBridgeTool(
                name=str(spec["name"]),
                description=str(spec["description"]) or "arena tool",
                tool_name=str(spec["name"]),
            )
        )
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
