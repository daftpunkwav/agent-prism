/**
 * @file tool-batch tests
 * @description Locks the shared driver tool-batch executor: prior-name collection,
 *              authorization, drift blocking, outcome events, and abort propagation.
 *
 * Responsibilities:
 * - Pin the prior-name timing contract the drift guard depends on
 * - Cover the action/observation/file_diff/tool_progress event sequence
 * - Cover error convergence (tool throw → error text) and AbortError rethrow
 */

import { describe, expect, it, vi } from "vitest";
import type { LlmAssistantMessage, LlmMessage, ToolExecutionResult } from "@agentprism/contracts";
import type { AgentExecutionContext } from "@agentprism/harness";
import { collectPriorToolNames, executeToolCalls, isToolBatchMessage } from "../src/tool-batch.js";

function assistantWithCalls(...calls: Array<{ name: string; args?: Record<string, unknown> }>): LlmAssistantMessage {
  return {
    role: "assistant",
    content: "",
    toolCalls: calls.map((call, index) => ({ id: `c${index}`, name: call.name, args: call.args ?? {} })),
  } as LlmAssistantMessage;
}

function contextWith(
  execute: (name: string, args: Record<string, unknown>) => Promise<ToolExecutionResult>,
  options: { names?: string[]; harness?: string; signal?: AbortSignal } = {},
): AgentExecutionContext {
  return {
    config: { label: "col", harness: options.harness ?? "bare" },
    workspace: { name: "ws" },
    tools: { names: new Set(options.names ?? []), execute },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  } as unknown as AgentExecutionContext;
}

/** Long enough that the drift guard's overlap ratio stays under its threshold. */
const DRIFT_QUESTION =
  "Explain the quarterly revenue trajectory across regional markets and outline the strategic implications for the upcoming planning cycle";

const okResult = (result: string, fileDiff: ToolExecutionResult["fileDiff"] = null): ToolExecutionResult => ({
  result,
  fileDiff,
  ok: true,
});

async function collect(
  context: AgentExecutionContext,
  response: LlmAssistantMessage,
  prior: string[] = [],
  question = "q",
): Promise<unknown[]> {
  const stats = { step: 0, turns: 0, toolCalls: 0 };
  const out: unknown[] = [];
  for await (const item of executeToolCalls(context, response, question, prior, stats)) out.push(item);
  return out;
}

describe("isToolBatchMessage", () => {
  it("splits tool messages from arena events", () => {
    expect(isToolBatchMessage({ role: "tool", content: "r", toolCallId: "c1" } as never)).toBe(true);
    expect(isToolBatchMessage({ type: "observation", result: "r" } as never)).toBe(false);
  });
});

describe("collectPriorToolNames", () => {
  it("collects assistant tool-call names in order", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "q" },
      assistantWithCalls({ name: "read" }, { name: "write" }),
      assistantWithCalls({ name: "ls" }),
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
    const outputs = await collect(contextWith(execute as never), assistantWithCalls({ name: "ghost" }));
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ role: "tool", name: "ghost" });
    expect(String((outputs[0] as { content: string }).content)).toContain("not authorized");
    expect(execute).not.toHaveBeenCalled();
  });

  it("resolves the model's casing to the canonical registered name", async () => {
    const execute = vi.fn(async () => okResult("done"));
    const outputs = await collect(
      contextWith(execute as never, { names: ["read"] }),
      assistantWithCalls({ name: "READ" }),
    );
    expect(execute).toHaveBeenCalledWith("read", {}, expect.anything());
    expect(outputs.at(-1)).toMatchObject({ role: "tool", name: "read", content: "done" });
  });
});

describe("executeToolCalls execution", () => {
  it("emits action then observation and hands the model the full result text", async () => {
    const execute = vi.fn(async () => okResult("file body"));
    const outputs = await collect(
      contextWith(execute as never, { names: ["read"] }),
      assistantWithCalls({ name: "read", args: { path: "a.txt" } }),
    );
    expect(outputs.map((o) => (o as { type?: string }).type ?? "tool")).toEqual(["action", "observation", "tool"]);
    expect(outputs[1]).toMatchObject({ type: "observation", result: "file body" });
    // The observation is capped for display; the ToolMessage keeps the raw result.
    expect(outputs[2]).toMatchObject({ role: "tool", content: "file body" });
  });

  it("emits a file_diff event when the tool reports one", async () => {
    const diff = { path: "a.txt", before: "x", after: "y" } as unknown as ToolExecutionResult["fileDiff"];
    const execute = vi.fn(async () => okResult("written", diff));
    const outputs = await collect(
      contextWith(execute as never, { names: ["write"] }),
      assistantWithCalls({ name: "write", args: { path: "a.txt" } }),
    );
    expect(outputs.some((o) => (o as { type?: string }).type === "file_diff")).toBe(true);
  });

  it("streams bash output as tool_progress chunks", async () => {
    const execute = vi.fn(async () => okResult("x".repeat(900)));
    const outputs = await collect(
      contextWith(execute as never, { names: ["bash"] }),
      assistantWithCalls({ name: "bash", args: { command: "echo" } }),
    );
    const progress = outputs.filter((o) => (o as { type?: string }).type === "tool_progress");
    expect(progress).toHaveLength(3);
  });

  it("blocks a drifting call and tells the model instead of executing", async () => {
    const execute = vi.fn(async () => okResult("should not run"));
    const outputs = await collect(
      contextWith(execute as never, { names: ["write"], harness: "verify" }),
      assistantWithCalls({ name: "write", args: { path: "z9/z9.md", content: "qqqq ".repeat(40) } }),
      ["read"],
      DRIFT_QUESTION,
    );
    expect(execute).not.toHaveBeenCalled();
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ role: "tool", name: "write" });
    expect(String((outputs[0] as { content: string }).content)).toContain("Guard rejected");
  });

  it("converges a throwing tool into error text the model can recover from", async () => {
    const execute = vi.fn(async () => {
      throw new Error("disk on fire");
    });
    const outputs = await collect(
      contextWith(execute as never, { names: ["write"] }),
      assistantWithCalls({ name: "write" }),
    );
    const tool = outputs.at(-1) as { role: string; content: string };
    expect(tool.role).toBe("tool");
    expect(tool.content).toContain("failed");
    // Only the exception type is exposed; the raw message may carry paths or secrets.
    expect(tool.content).not.toContain("disk on fire");
    expect(outputs.some((o) => (o as { type?: string }).type === "observation")).toBe(true);
  });

  it("propagates AbortError instead of reporting it as a tool failure", async () => {
    const execute = vi.fn(async () => {
      const abort = new Error("Aborted");
      abort.name = "AbortError";
      throw abort;
    });
    await expect(
      collect(contextWith(execute as never, { names: ["write"] }), assistantWithCalls({ name: "write" })),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
