// Fake autogen bootstrap for bridge tests: replays protocol scenarios.
//
// FAKE_SCENARIO=session (default): echoes the handshake tool catalog and task text
// as events, issues one completion with the catalog forwarded (the coder turn
// shape) and one with no tools (the reviewer turn shape), then lands a final.
//
// FAKE_SCENARIO=drift: sends a transcript that already carries a prior tool call and
// then requests an unrelated bash call, so the host-side drift guard has both its
// prior-name input and a call it must reject.
import { createInterface } from "node:readline";

const scenario = process.env.FAKE_SCENARIO ?? "session";
const send = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);

/** Session shape: banner/task echo, one tool-bound completion, one tool-less completion, final. */
function runSession(lines) {
  const replies = [];
  lines.on("line", (raw) => {
    const message = JSON.parse(raw);
    if (message.type === "start") {
      send({
        type: "event",
        kind: "assistant",
        speaker: "coder",
        content: `catalog:${message.tools.map((tool) => tool.name).join(",")}`,
      });
      // Reviewer speech rides the reflect channel: the handshake task text becomes
      // observable there without touching the coder/answer channel.
      send({ type: "event", kind: "assistant", speaker: "reviewer", content: `task:${message.question}` });
      send({
        type: "llm_request",
        id: "llm-1",
        messages: [{ role: "user", content: message.question }],
        tools: message.tools,
      });
      return;
    }
    if (message.type === "llm_response") {
      replies.push(message.content);
      if (replies.length === 1) {
        send({ type: "llm_request", id: "llm-2", messages: [{ role: "user", content: "second" }], tools: [] });
        return;
      }
      send({ type: "final", answer: `done:${replies.length}` });
      // The real Python bootstraps exit after `final` (the stdin pump is a
      // daemon thread); readline would keep this process alive, so exit hard.
      process.exit(0);
    }
  });
}

/** Drift shape: prior `bash` call in the transcript, then an unrelated `bash` request. */
function runDrift(lines) {
  lines.on("line", (raw) => {
    const message = JSON.parse(raw);
    if (message.type === "start") {
      send({
        type: "llm_request",
        id: "llm-1",
        messages: [
          { role: "user", content: message.question },
          {
            role: "assistant",
            content: "",
            // A prior call the transcript already carries: the drift guard's baseline.
            toolCalls: [{ id: "prior-1", name: "bash", args: "{\"command\":\"ls\"}" }],
          },
          { role: "tool", content: "files", toolCallId: "prior-1", name: "bash" },
        ],
        tools: message.tools,
      });
      return;
    }
    if (message.type === "llm_response") {
      send({ type: "tool_request", id: "tool-1", name: "bash", args: "{\"command\":\"echo zzz\"}" });
      return;
    }
    if (message.type === "tool_result") {
      // The (possibly rejected) outcome travels back as reviewer speech so the test
      // can read it, then the session ends.
      send({ type: "event", kind: "assistant", speaker: "reviewer", content: `outcome:${message.result}` });
      send({ type: "final", answer: "drift done" });
      process.exit(0);
    }
  });
}

const lines = createInterface({ input: process.stdin });
if (scenario === "drift") runDrift(lines);
else runSession(lines);
