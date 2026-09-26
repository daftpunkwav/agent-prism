// Fake autogen bootstrap for bridge tests: echoes the handshake tool catalog as
// an event, issues one completion with the catalog forwarded (the coder turn
// shape) and one with no tools (the reviewer turn shape), then lands a final.
import { createInterface } from "node:readline";

const replies = [];
const send = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);
const lines = createInterface({ input: process.stdin });

lines.on("line", (raw) => {
  const message = JSON.parse(raw);
  if (message.type === "start") {
    send({
      type: "event",
      kind: "assistant",
      speaker: "coder",
      content: `catalog:${message.tools.map((tool) => tool.name).join(",")}`,
    });
    send({
      type: "llm_request",
      id: "llm-1",
      messages: [{ role: "user", content: message.question }],
      tools: message.tools,
    });
  } else if (message.type === "llm_response") {
    replies.push(message.content);
    if (replies.length === 1) {
      send({ type: "llm_request", id: "llm-2", messages: [{ role: "user", content: "second" }], tools: [] });
    } else {
      send({ type: "final", answer: `done:${replies.length}` });
      // The real Python bootstraps exit after `final` (the stdin pump is a
      // daemon thread); readline would keep this process alive, so exit hard.
      process.exit(0);
    }
  }
});
