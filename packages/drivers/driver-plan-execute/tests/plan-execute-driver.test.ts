/**
 * @file plan-execute-driver test
 * @description Locks planner-then-executor behavior with a scripted LLM stub.
 */
import { describe, expect, it, vi } from "vitest";
import type { ArenaEvent, LlmAdapter, LlmInvokeResult, LlmMessage, LlmStreamPart, ToolDefinition } from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import { RagStoreCache } from "@agentprism/harness";
import type { AgentExecutionContext } from "@agentprism/harness";
import { MapToolRegistry } from "@agentprism/tool-registry";
import { TokenTracker } from "@agentprism/telemetry";
import { SystemClock } from "@agentprism/runtime";
import { PlanExecuteDriver } from "../src/plan-execute-driver.js";

/** Scripted LLM: queued invoke replies and stream replies per call. */
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
  const tools = {
    registry,
    names,
    execute: (name: string, args: Record<string, unknown>) => registry.execute(workspace, name, args, { authorizedNames: names }),
  };
  return {
    identity: { agentId: "a", runId: "r" },
    config: PipelineConfigSchema.parse({ label: "col", harness: "bare", max_steps: 5, reasoning }),
    question: "write hi.txt",
    history: [],
    turn: 1,
    workspace,
    tracker: new TokenTracker({ contextWindow: 100000 }),
    clock: new SystemClock(),
    rag: new RagStoreCache(),
    llm,
    llmVendor: null,
    tools,
  };
}

async function collect(driver: PlanExecuteDriver, ctx: AgentExecutionContext): Promise<ArenaEvent[]> {
  const events: ArenaEvent[] = [];
  for await (const event of driver.run(ctx)) events.push(event);
  return events;
}

describe("PlanExecuteDriver", () => {
  it("plans first, then executes tools, ending complete", async () => {
    const llm = stubLlm(["1. Write hi.txt\n2. Verify"], [
      { text: "working", toolCalls: [{ id: "c1", name: "read", args: { path: "hi.txt" } }] },
      { text: "done" },
    ]);
    const events = await collect(new PlanExecuteDriver(), contextWith(llm));
    const types = events.map((e) => e.type);
    expect(types).toContain("reflect");
    expect(types).toContain("action");
    expect(types).toContain("observation");
    expect(types).toContain("complete");
    const plan = events.find((e) => e.type === "reflect");
    expect(plan?.content).toContain("1. Write hi.txt");
    const complete = events.find((e) => e.type === "complete");
    expect(complete?.metrics?.tool_calls).toBe(1);
    expect(complete?.metrics?.success).toBe(true);
  });

  it("repl meanwhile on stalled quiet turns exactly once", async () => {
    const llm = stubLlm(["1. Step one", "1. Revised step"], [{ text: "thinking aloud" }, { text: "still thinking" }, { text: "final" }]);
    const events = await collect(new PlanExecuteDriver(), contextWith(llm));
    const reflects = events.filter((e) => e.type === "reflect").map((e) => e.content);
    expect(reflects.some((c) => c.includes("[Plan-Execute plan]"))).toBe(true);
    expect(reflects.some((c) => c.includes("[Plan-Execute replan]"))).toBe(true);
    expect(events.some((e) => e.type === "complete")).toBe(true);
  });

  it("runs without a plan when the planner fails", async () => {
    const llm: LlmAdapter = {
      async invoke(): Promise<LlmInvokeResult> { throw new Error("planner down"); },
      async *stream(_messages: LlmMessage[]): AsyncGenerator<LlmStreamPart> { yield { text: "direct answer" }; },
    };
    const events = await collect(new PlanExecuteDriver(), contextWith(llm));
    expect(events.some((e) => e.type === "reflect")).toBe(false);
    expect(events.some((e) => e.type === "complete")).toBe(true);
  });

  it("emits temp/model/max_steps in the Step-0 config banner", async () => {
    const llm = stubLlm(["1. Step one"], [{ text: "final" }]);
    const events = await collect(new PlanExecuteDriver(), contextWith(llm));
    const banner = events.find((event) => event.type === "thought");
    expect(banner?.content).toContain("temp=0");
    expect(banner?.content).toContain("model=");
    expect(banner?.content).toContain("max_steps=5");
  });
});

describe("PlanExecuteDriver reasoning modes", () => {
  it("tot branches for real: independent candidate calls each scored, argmax winner", async () => {
    vi.stubEnv("ARENA_TOT_WIDTH", "2");
    try {
      let invokes = 0;
      const llm: LlmAdapter = {
        async invoke(): Promise<LlmInvokeResult> {
          invokes += 1;
          // Branch 1 generates "Plan 1", branch 2 generates "Plan 2", then two score calls.
          return { text: invokes === 1 ? "Plan 1" : invokes === 2 ? "Plan 2" : "SCORE: 3", toolCalls: [] };
        },
        // Every executor turn calls a tool so no stall-replan fires: invokes stay at 2*width.
        async *stream(): AsyncGenerator<LlmStreamPart> {
          yield { toolCalls: [{ id: "c1", name: "read", args: {} }] };
        },
      };
      const events = await collect(new PlanExecuteDriver(), contextWith(llm, "tot"));
      expect(invokes).toBe(4);
      const plan = events.find((e) => e.type === "reflect");
      expect(plan?.content).toContain("Plan 1");
      expect(plan?.content).not.toContain("Plan 2");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reflexion allows two replans while react allows one", async () => {
    async function replanCount(reasoning: string): Promise<number> {
      const plans = ["p0", "p1", "p2"];
      let at = 0;
      const llm: LlmAdapter = {
        async invoke(): Promise<LlmInvokeResult> {
          return { text: plans[Math.min(at++, plans.length - 1)] ?? "", toolCalls: [] };
        },
        async *stream(): AsyncGenerator<LlmStreamPart> {
          yield { text: "quiet" };
        },
      };
      const events = await collect(new PlanExecuteDriver(), contextWith(llm, reasoning));
      return events.filter((e) => e.type === "reflect" && e.content.includes("[Plan-Execute replan]")).length;
    }
    expect(await replanCount("react")).toBe(1);
    expect(await replanCount("reflexion")).toBe(2);
  });
});
