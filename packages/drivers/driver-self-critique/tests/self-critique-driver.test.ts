/**
 * @file self-critique-driver test
 * @description Locks per-batch critic scoring and redirect budgets.
 */
import { describe, expect, it } from "vitest";
import type { ArenaEvent, LlmAdapter, LlmInvokeResult, LlmStreamPart, ToolDefinition } from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import { RagStoreCache } from "@agentprism/harness";
import type { AgentExecutionContext } from "@agentprism/harness";
import { MapToolRegistry } from "@agentprism/tool-registry";
import { TokenTracker } from "@agentprism/telemetry";
import { SystemClock } from "@agentprism/runtime";
import { parseCriticVerdict, SelfCritiqueDriver } from "../src/self-critique-driver.js";

function stubLlm(invokes: string[], streams: Array<{ text?: string; toolCalls?: LlmInvokeResult["toolCalls"] }>): LlmAdapter {
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

function contextWith(llm: LlmAdapter, reasoning: string = "react"): AgentExecutionContext {
  const registry = new MapToolRegistry();
  registry.register({
    name: "read",
    description: "read",
    jsonSchema: { type: "object", properties: {} },
    mutatesWorkspace: false,
    execute: async () => ({ result: "content", fileDiff: null, ok: true }),
  } as ToolDefinition);
  const names = new Set(["read"]);
  const workspace = { name: "ws", cwd: () => "/tmp/ws", fs: {} } as unknown as AgentExecutionContext["workspace"];
  return {
    identity: { agentId: "a", runId: "r" },
    config: PipelineConfigSchema.parse({ label: "col", harness: "bare", max_steps: 6, reasoning }),
    question: "q",
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
  };
}

async function collect(ctx: AgentExecutionContext): Promise<ArenaEvent[]> {
  const events: ArenaEvent[] = [];
  for await (const event of new SelfCritiqueDriver().run(ctx)) events.push(event);
  return events;
}

describe("parseCriticVerdict", () => {
  it("parses scores and notes, rejecting malformed replies", () => {
    expect(parseCriticVerdict("SCORE: 8\nNEXT: DONE")).toEqual({ score: 8, note: "NEXT: DONE" });
    expect(parseCriticVerdict("score: 3\nnext: retry the write")).toEqual({ score: 3, note: "next: retry the write" });
    expect(parseCriticVerdict("looks fine")).toBeNull();
  });
});

describe("SelfCritiqueDriver", () => {
  it("scores batches and finishes when the critic is satisfied", async () => {
    const llm = stubLlm(["SCORE: 7\nNEXT: DONE"], [
      { text: "acting", toolCalls: [{ id: "c1", name: "read", args: {} }] },
      { text: "final answer here" },
    ]);
    const events = await collect(contextWith(llm));
    const types = events.map((e) => e.type);
    expect(types).toContain("action");
    expect(types).toContain("reflect");
    expect(types).toContain("complete");
    const verdicts = events.filter((e) => e.type === "reflect").map((e) => e.content);
    expect(verdicts.some((c) => c.includes("Critic score 7"))).toBe(true);
    expect(events.find((e) => e.type === "complete")?.metrics?.success).toBe(true);
  });

  it("redirects on low scores within budget", async () => {
    const llm = stubLlm(
      ["SCORE: 2\nNEXT: actually write the file", "SCORE: 9\nNEXT: DONE"],
      [
        { text: "vague", toolCalls: [{ id: "c1", name: "read", args: {} }] },
        { text: "concrete work" },
      ],
    );
    const events = await collect(contextWith(llm));
    const verdicts = events.filter((e) => e.type === "reflect").map((e) => e.content);
    expect(verdicts.some((c) => c.includes("Critic redirect 1/2"))).toBe(true);
    expect(events.some((e) => e.type === "complete")).toBe(true);
  });
});

describe("criticBudgetFor", () => {
  it("grants reflexion one extra redirect", async () => {
    const { criticBudgetFor } = await import("../src/self-critique-driver.js");
    expect(criticBudgetFor("react")).toBe(2);
    expect(criticBudgetFor("reflexion")).toBe(3);
  });

  it("reflexion sustains three low-score redirects", async () => {
    const llm = stubLlm(
      ["SCORE: 1\nNEXT: try harder", "SCORE: 1\nNEXT: try again", "SCORE: 1\nNEXT: last try", "SCORE: 9\nNEXT: DONE"],
      [{ text: "w1" }, { text: "w2" }, { text: "w3" }, { text: "w4" }, { text: "final" }],
    );
    const events = await collect(contextWith(llm, "reflexion"));
    const verdicts = events.filter((e) => e.type === "reflect").map((e) => e.content);
    expect(verdicts.some((c) => c.includes("Critic redirect 3/3"))).toBe(true);
  });
});
