/**
 * @file summary-entities test
 * @description Locks entity-preserving overflow summaries (heads, tails, signals).
 */
import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@agentprism/contracts";
import { prepareMessagesForLlm } from "../src/context/messages.js";
import { summarizeMessages } from "../src/context/messages.js";

function toolMsg(name: string, content: string): LlmMessage {
  return { role: "tool", content, toolCallId: `c-${name}`, name };
}

describe("summarizeMessages", () => {
  it("preserves error tails, signals, and paths that head-cuts drop", () => {
    const log = [`building src/main.go`, ...Array.from({ length: 100 }, (_, i) => `step ${i} ok`), `FATAL: nil deref in src/main.go:42`].join("\n");
    const summary = summarizeMessages([toolMsg("run", log)]);
    expect(summary).toContain("FATAL: nil deref in src/main.go:42");
    expect(summary).toContain("src/main.go");
    expect(summary).toContain("102 lines");
  });

  it("keeps assistant tool-call names and skips nested summaries", () => {
    const summary = summarizeMessages([
      { role: "assistant", content: "let me check", toolCalls: [{ id: "1", name: "read", args: {} }, { id: "2", name: "run", args: {} }] },
      { role: "system", content: "[Context summary]\nold stuff" },
      { role: "user", content: "go" },
    ]);
    expect(summary).toContain("[called: read, run]");
    expect(summary).not.toContain("old stuff");
  });

  it("caps huge overflows loudly", () => {
    const messages: LlmMessage[] = Array.from({ length: 200 }, (_, i) => toolMsg("run", `output block ${i}\n`.repeat(50)));
    const summary = summarizeMessages(messages);
    expect(summary.length).toBeLessThanOrEqual(4100);
    expect(summary).toContain("summary capped");
  });
});

describe("summary strategy wiring", () => {
  it("emits a [Context summary] system message with entities on overflow", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "start" },
      { role: "assistant", content: "a", toolCalls: [{ id: "1", name: "grep", args: {} }] },
      toolMsg("grep", `hit in src/app.ts\n`.repeat(300)),
      ...Array.from({ length: 14 }, (_, i): LlmMessage => ({ role: "user", content: `q${i}` })),
    ];
    const out = prepareMessagesForLlm(messages, "summary", { windowSize: 4 });
    const marker = out.find((m) => m.role === "system" && m.content.startsWith("[Context summary]"));
    expect(marker).toBeDefined();
    expect(marker!.content).toContain("src/app.ts");
    expect(marker!.content).toContain("grep");
  });
});
