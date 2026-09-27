// Fake bootstrap: replays protocol scenarios for the crewai-bridge tests.
// Usage: node fake-bootstrap.mjs '{"scenario":"flood"}' (or FAKE_SCENARIO env).
// The start handshake arrives on stdin but scenarios ignore it; the flood
// scenario issues more llm requests than the handshake budget and echoes the
// over-budget response content back as an event so the test can assert the
// host-side budget note. The handshake scenario echoes the task text the bridge
// forwarded and sends a role-style system turn, so the test can assert what the
// arena prompt assembly produced.

import { createInterface } from "node:readline";

const argScenario = JSON.parse(process.argv[2] ?? "{}").scenario;
const scenario = argScenario ?? process.env.FAKE_SCENARIO ?? "flood";
const emit = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);

if (scenario === "handshake") {
  const rl = createInterface({ input: process.stdin });
  let requests = 0;
  rl.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.type === "start") {
      // The task text the host forwarded, observable on the reflect channel.
      emit({ type: "event", kind: "assistant", speaker: "researcher", content: `task:${message.question}` });
      // First completion carries the framework's own role system turn.
      emit({
        type: "llm_request",
        id: "llm-1",
        messages: [
          { role: "system", content: "[CrewAI Researcher] role copy" },
          { role: "user", content: "do the task" },
        ],
      });
      return;
    }
    if (message.type === "llm_response") {
      requests += 1;
      if (requests === 1) {
        // Second completion: the framework's accumulated transcript, no task text.
        emit({
          type: "llm_request",
          id: "llm-2",
          messages: [
            { role: "system", content: "[CrewAI Researcher] role copy" },
            { role: "user", content: "do the task" },
            { role: "assistant", content: "work" },
            { role: "user", content: "continue" },
          ],
        });
        return;
      }
      emit({ type: "final", answer: "handshake done" });
      process.exit(0);
    }
  });
}

if (scenario === "drift") {
  // A transcript that already carries a prior tool call, then an unrelated bash
  // request: the host-side drift guard has both its prior-name input and a call
  // it must reject (the guarded harness levels only).
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.type === "start") {
      emit({
        type: "llm_request",
        id: "llm-1",
        messages: [
          { role: "system", content: "[CrewAI Coder] role copy" },
          { role: "user", content: message.question },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "prior-1", name: "bash", args: "{\"command\":\"ls\"}" }],
          },
          { role: "tool", content: "files", toolCallId: "prior-1", name: "bash" },
        ],
      });
      return;
    }
    if (message.type === "llm_response") {
      emit({ type: "tool_request", id: "tool-1", name: "bash", args: "{\"command\":\"echo zzz\"}" });
      return;
    }
    if (message.type === "tool_result") {
      emit({ type: "event", kind: "assistant", speaker: "researcher", content: `outcome:${message.result}` });
      emit({ type: "final", answer: "drift done" });
      process.exit(0);
    }
  });
} else if (scenario === "flood") {
  // Three llm requests against a handshake budget of 2: the third must be
  // answered by the host's budget-exhausted note, not by the arena model.
  emit({ type: "llm_request", id: "llm-1", messages: [{ role: "user", content: "q?" }] });
  emit({ type: "llm_request", id: "llm-2", messages: [{ role: "user", content: "q?" }] });
  emit({ type: "llm_request", id: "llm-3", messages: [{ role: "user", content: "q?" }] });
  const responses = new Map();
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.type === "llm_response") {
      responses.set(message.id, message.content);
      if (message.id === "llm-3") {
        emit({ type: "event", kind: "assistant", speaker: "researcher", content: responses.get("llm-3") });
        emit({ type: "final", answer: "flood done" });
        // The readline interface holds stdin open; a real bootstrap exits when
        // main returns, so mirror that explicitly.
        process.exit(0);
      }
    }
  });
}
