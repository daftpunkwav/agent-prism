/**
 * @file autogen-driver test
 * @description Locks group-chat rounds: selection, tool proxy, termination, budgets.
 */
import { describe, expect, it } from "vitest";
import type { ArenaEvent, LlmAdapter, LlmInvokeResult, LlmStreamPart, ToolDefinition } from "@agentprism/contracts";
import { extractAnswerFromEvents, PipelineConfigSchema } from "@agentprism/contracts";
import { RagStoreCache } from "@agentprism/harness";
import type { AgentExecutionContext } from "@agentprism/harness";
import { MapToolRegistry } from "@agentprism/tool-registry";
import { TokenTracker } from "@agentprism/telemetry";
import { SystemClock } from "@agentprism/runtime";
import { AutogenDriver, reviewerBudgetFor } from "../src/autogen-driver.js";
import { AUTOGEN_TERMINATE_KEYWORD } from "../src/group-chat.js";

/** Scripted LLM: queued invoke replies (selections) and stream replies (speaker turns). */
function stubLlm(invokes: string[], streams: Array<{ text?: string; toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }> }>): LlmAdapter {
  let invokeAt = 0;
  let streamAt = 0;
  return {
    async invoke(): Promise<LlmInvokeResult> {
      const text = invokes[Math.min(invokeAt++, invokes.length - 1)] ?? "";
      return { text, toolCalls: [] };
    },
    async *stream(): AsyncGenerator<LlmStreamPart> {
      const reply = streams[Math.min(streamAt++, streams.length - 1)] ?? {};
      if (reply.text) yield { text: reply.text };
      if (reply.toolCalls) yield { toolCalls: reply.toolCalls };
    },
  };
}

function readTool(): ToolDefinition {
  return {
    name: "read",
    description: "read",
    jsonSchema: { type: "object", properties: {} },
    mutatesWorkspace: false,
    execute: async () => ({ result: "file content here", fileDiff: null, ok: true }),
  };
}

function contextWith(llm: LlmAdapter, reasoning: string = "react"): AgentExecutionContext {
  const registry = new MapToolRegistry();
  const tool = readTool();
  registry.register(tool);
  const names = new Set(["read"]);
  const workspace = { name: "ws", cwd: () => "/tmp/ws", fs: {} } as unknown as AgentExecutionContext["workspace"];
  return {
    identity: { agentId: "a", runId: "r" },
    config: PipelineConfigSchema.parse({ label: "col", harness: "bare", max_steps: 16, reasoning }),
    question: "write hi.txt",
    history: [],
    turn: 1,
    workspace,
    tracker: new TokenTracker({ contextWindow: 100000 }),
    clock: new SystemClock(),
    rag: new RagStoreCache(),
    llm,
    llmVendor: null,
    tools: {
      registry,
      names,
      execute: (name: string, args: Record<string, unknown>) => registry.execute(workspace, name, args, { authorizedNames: names }),
    },
  } as AgentExecutionContext;
}

async function collect(driver: AutogenDriver, ctx: AgentExecutionContext): Promise<ArenaEvent[]> {
  const events: ArenaEvent[] = [];
  for await (const event of driver.run(ctx)) events.push(event);
  return events;
}

describe("AutogenDriver", () => {
  it("alternates coder/reviewer rounds until the reviewer terminates", async () => {
    const llm = stubLlm(
      ["coder", "reviewer", "coder", "reviewer"],
      [
        { text: "checking the file", toolCalls: [{ id: "c1", name: "read", args: { path: "hi.txt" } }] },
        { text: "not done yet, one more pass" },
        { text: "final answer: artifact ready" },
        { text: `${AUTOGEN_TERMINATE_KEYWORD}: complete and verified` },
      ],
    );
    const events = await collect(new AutogenDriver(), contextWith(llm));
    const types = events.map((event) => event.type);
    expect(types).toContain("action");
    expect(types).toContain("observation");
    expect(types).toContain("complete");
    // Selections and critiques ride reflect; the coder's final reply stays the answer.
    const reflects = events.filter((event) => event.type === "reflect").map((event) => event.content);
    expect(reflects.filter((content) => content.includes("speaker: coder")).length).toBe(2);
    expect(reflects.filter((content) => content.includes("speaker: reviewer")).length).toBe(2);
    expect(reflects.some((content) => content.includes("[AutoGen reviewer]"))).toBe(true);
    expect(extractAnswerFromEvents(events)).toBe("final answer: artifact ready");
    const complete = events.find((event) => event.type === "complete");
    expect(complete?.metrics?.success).toBe(true);
    expect(complete?.metrics?.tool_calls).toBe(1);
    // Two rounds of selection + speaker: 8 LLM calls, then termination.
    expect(complete?.metrics?.steps).toBe(8);
  });

  it("stops immediately when the first reviewer speech terminates the chat", async () => {
    const llm = stubLlm(
      ["reviewer"],
      [{ text: `${AUTOGEN_TERMINATE_KEYWORD}: nothing to do` }],
    );
    const events = await collect(new AutogenDriver(), contextWith(llm));
    const complete = events.find((event) => event.type === "complete");
    expect(complete?.metrics?.success).toBe(true);
    // One selection call + one reviewer speech, nothing else.
    expect(complete?.metrics?.steps).toBe(2);
  });

  it("falls back to the coder when the selection reply is garbage", async () => {
    const llm = stubLlm(
      ["the task looks fine"],
      [{ text: "doing the work now" }],
    );
    const events = await collect(new AutogenDriver(), contextWith(llm));
    expect(extractAnswerFromEvents(events)).toBe("doing the work now");
    const complete = events.find((event) => event.type === "complete");
    expect(complete?.metrics?.success).toBe(true);
  });

  it("grants reflexion one extra reviewer speech", () => {
    expect(reviewerBudgetFor("react")).toBe(2);
    expect(reviewerBudgetFor("reflexion")).toBe(3);
  });
});
