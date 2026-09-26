// Fake bootstrap: replays protocol scenarios for the crewai-bridge tests.
// Usage: node fake-bootstrap.mjs '{"scenario":"flood"}'
// The start handshake arrives on stdin but scenarios ignore it; the flood
// scenario issues more llm requests than the handshake budget and echoes the
// over-budget response content back as an event so the test can assert the
// host-side budget note.

import { createInterface } from "node:readline";

const scenario = JSON.parse(process.argv[2] ?? "{}").scenario ?? "flood";
const emit = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);

if (scenario === "flood") {
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
