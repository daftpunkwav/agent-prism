// Fake bootstrap: replays protocol scenarios for the child-bridge tests.
// Usage: node fake-bootstrap.mjs '{"scenario":"happy", ...overrides}'
// The start handshake arrives on stdin but scenarios ignore it; the happy
// scenario issues one llm request and one tool request, then finishes after
// the host's tool_result line arrives.

import { createInterface } from "node:readline";

const scenario = JSON.parse(process.argv[2] ?? "{}").scenario ?? "happy";
const emit = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);

if (scenario === "happy") {
  emit({ type: "llm_request", id: "llm-1", messages: [{ role: "user", content: "q?" }] });
  emit({ type: "tool_request", id: "tool-1", name: "read", args: "{}" });
  emit({ type: "event", kind: "phase", speaker: "system", content: "phase-1" });
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.type === "tool_result" && message.ok) {
      emit({ type: "event", kind: "assistant", speaker: "coder", content: `assistant-1:${message.result}` });
      emit({ type: "final", answer: "bridge answer" });
      // The readline interface holds stdin open; a real bootstrap exits when
      // main returns, so mirror that explicitly.
      process.exit(0);
    }
  });
} else if (scenario === "error") {
  emit({ type: "error", message: "framework exploded" });
} else if (scenario === "junk") {
  // Valid-JSON lines that are not protocol messages (the bare `null` used to
  // crash the host): all of them must be dropped, the final must still land.
  process.stdout.write("null\n");
  process.stdout.write("\"just a string\"\n");
  process.stdout.write("[1, 2, 3]\n");
  emit({ type: "final", answer: "bridge answer" });
} else if (scenario === "hang") {
  // One llm request, then nothing: the host's abort/kill is the only way out,
  // and the late llm_response write lands on the dead child's stdin. The
  // interval holds the process open until the kill arrives.
  emit({ type: "llm_request", id: "llm-1", messages: [{ role: "user", content: "q?" }] });
  setInterval(() => {}, 1_000);
}
// scenario "silent": exit with no protocol lines at all.
