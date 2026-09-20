/**
 * @file tool batch tests
 * @description Locks native batch execution: prior-name collection and authorization gate.
 */

import { describe, expect, it, vi } from "vitest";
import type { LlmAssistantMessage, LlmMessage } from "@agentprism/contracts";
import type { AgentExecutionContext } from "@agentprism/harness";
import { collectPriorToolNames, executeToolCalls } from "../src/tool-batch.js";

function assistantWithCalls(...names: string[]): LlmAssistantMessage {
  return {
    role: "assistant",
    content: "",
    toolCalls: names.map((name, index) => ({ id: `c${index}`, name, args: {} })),
  } as LlmAssistantMessage;
}

describe("collectPriorToolNames", () => {
  it("collects assistant tool-call names in order", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "q" },
      assistantWithCalls("read", "write"),
      assistantWithCalls("ls"),
    ];
    expect(collectPriorToolNames(messages)).toEqual(["read", "write", "ls"]);
  });

  it("ignores messages without tool calls", () => {
    expect(collectPriorToolNames([{ role: "user", content: "q" }])).toEqual([]);
  });
});

describe("executeToolCalls authorization", () => {
  it("yields an unauthorized tool message without executing", async () => {
    const execute = vi.fn();
    const context = {
      config: { label: "col" },
      workspace: { name: "ws" },
      tools: { names: new Set<string>(), execute },
      signal: undefined,
    } as unknown as AgentExecutionContext;
    const response = assistantWithCalls("ghost");
    const outputs = [];
    for await (const output of executeToolCalls(context, response, "q", [], { step: 0, turns: 0, toolCalls: 0 })) {
      outputs.push(output);
    }
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ role: "tool", name: "ghost" });
    expect(String((outputs[0] as { content: string }).content)).toContain("not authorized");
    expect(execute).not.toHaveBeenCalled();
  });
});
