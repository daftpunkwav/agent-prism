/**
 * @file self-consistency test
 * @description Locks the native SC loop: fresh attempts, vote tally, winner thought.
 */
import { describe, expect, it, vi } from "vitest";
import type { ArenaEvent, LlmAdapter, LlmInvokeResult, LlmMessage, LlmStreamPart } from "@agentprism/contracts";
import { extractAnswerFromEvents, PipelineConfigSchema } from "@agentprism/contracts";
import { RagStoreCache } from "@agentprism/harness";
import { assessToolRelevance, type AgentExecutionContext } from "@agentprism/harness";
import { MapToolRegistry } from "@agentprism/tool-registry";
import { TokenTracker } from "@agentprism/telemetry";
import { SystemClock } from "@agentprism/runtime";
import { NativeDriver } from "../src/native-driver.js";

/** Scripted LLM: one stream reply per call, no tool calls anywhere. */
function stubLlm(replies: string[]): LlmAdapter {
  let streamAt = 0;
  return {
    async invoke(): Promise<LlmInvokeResult> {
      return { text: "", toolCalls: [] };
    },
    async *stream(): AsyncGenerator<LlmStreamPart> {
      const reply = replies[Math.min(streamAt++, replies.length - 1)] ?? "";
      yield { text: reply };
    },
  };
}

function contextWith(llm: LlmAdapter, reasoning: string): AgentExecutionContext {
  const registry = new MapToolRegistry();
  const workspace = { name: "ws", cwd: () => "/tmp/ws", fs: {} } as unknown as AgentExecutionContext["workspace"];
  const names = new Set<string>();
  return {
    identity: { agentId: "a", runId: "r" },
    config: PipelineConfigSchema.parse({ label: "col", harness: "bare", max_steps: 8, reasoning }),
    question: "answer the task",
    history: [],
    turn: 1,
    workspace,
    tracker: new TokenTracker({ contextWindow: 100000 }),
    clock: new SystemClock(),
    rag: new RagStoreCache(),
    llm,
    llmVendor: null,
    tools: { registry, names, execute: async () => ({ result: "", fileDiff: null, ok: true }) },
  } as AgentExecutionContext;
}

/** Scripted LLM: first call streams a tool call, the second settles the attempt with text. */
function toolThenTextLlm(toolName: string, args: Record<string, unknown>): LlmAdapter {
  let streamAt = 0;
  return {
    async invoke(): Promise<LlmInvokeResult> {
      return { text: "", toolCalls: [] };
    },
    async *stream(): AsyncGenerator<LlmStreamPart> {
      streamAt += 1;
      if (streamAt === 1) {
        yield { toolCalls: [{ id: "c1", name: toolName, args }] };
      } else {
        yield { text: "final answer" };
      }
    },
  };
}

async function collect(driver: NativeDriver, ctx: AgentExecutionContext): Promise<ArenaEvent[]> {
  const events: ArenaEvent[] = [];
  for await (const event of driver.run(ctx)) events.push(event);
  return events;
}

describe("NativeDriver self_consistency", () => {
  it("runs N independent attempts and re-emits the majority answer as the final thought", async () => {
    vi.stubEnv("ARENA_SELF_CONSISTENCY_N", "3");
    try {
      // Attempts answer A, B, A: majority picks A (attempt 1 and 3).
      const events = await collect(new NativeDriver(), contextWith(stubLlm(["A", "B", "A"]), "self_consistency"));
      const types = events.map((event) => event.type);
      expect(types).toContain("reflect");
      expect(types).toContain("complete");
      const reflect = events.filter((event) => event.type === "reflect").at(-1);
      expect(reflect?.content).toContain("3/3 attempt(s) completed");
      expect(reflect?.content).toContain("attempt 1 wins");
      const lastThought = events.filter((event) => event.type === "thought").at(-1);
      expect(lastThought?.content).toBe("A");
      const complete = events.find((event) => event.type === "complete");
      expect(complete?.metrics?.success).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  /**
   * Regression (prior-tool-names timing): prior names must be collected BEFORE
   * the current response is pushed onto the message list. If the response is
   * pushed first, the attempt's own call names read as prior history and the
   * drift guard blocks the very first tool call of the attempt.
   */
  it("executes the attempt's first tool call: prior names exclude the current response", async () => {
    // Sanity pin on the guard itself: these inputs must be rejected only when
    // the current call's own name leaks into prior history. If the heuristic
    // changes, this assertion flags it instead of letting the wiring regression
    // below pass silently.
    const question = "alpha beta gamma delta epsilon zeta iota kappa";
    const args = { z: "x".repeat(40) };
    expect(assessToolRelevance(question, "bash", args, ["bash"]).allowed).toBe(false);
    expect(assessToolRelevance(question, "bash", args, []).allowed).toBe(true);

    vi.stubEnv("ARENA_SELF_CONSISTENCY_N", "1");
    try {
      const execute = vi.fn(async () => ({ result: "tool ran", fileDiff: null, ok: true }));
      // Guarded harness (anything but "bare"): the drift guard is active, so a
      // wrongly-collected prior list would block this exact call.
      const ctx = contextWith(toolThenTextLlm("bash", args), "self_consistency");
      ctx.config = PipelineConfigSchema.parse({ label: "col", harness: "verify", max_steps: 8, reasoning: "self_consistency" });
      ctx.question = question;
      (ctx.tools.names as Set<string>).add("bash");
      ctx.tools.execute = execute;
      const events = await collect(new NativeDriver(), ctx);
      // The call ran: the executor saw an empty prior-name list.
      expect(execute).toHaveBeenCalledTimes(1);
      const types = events.map((event) => event.type);
      expect(types).toContain("action");
      expect(types).toContain("observation");
      const action = events.find((event) => event.type === "action");
      expect(action?.tool).toBe("bash");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("gives every attempt the full per-attempt step budget", async () => {
    vi.stubEnv("ARENA_SELF_CONSISTENCY_N", "3");
    try {
      // max_steps=1 limits each attempt to one LLM turn, yet all three run —
      // the budget is per attempt (same semantics as the langgraph loop).
      const config = PipelineConfigSchema.parse({ label: "col", harness: "bare", max_steps: 1, reasoning: "self_consistency" });
      const ctx = contextWith(stubLlm(["first", "second", "third", "never", "never"]), "self_consistency");
      ctx.config = config;
      const events = await collect(new NativeDriver(), ctx);
      const reflect = events.filter((event) => event.type === "reflect").at(-1);
      expect(reflect?.content).toContain("3/3 attempt(s) completed");
      // Exact tie breaks to the earliest attempt.
      const winnerThought = events.filter((event) => event.type === "thought").at(-1);
      expect(winnerThought?.content).toBe("first");
      const complete = events.find((event) => event.type === "complete");
      expect(complete?.metrics?.steps).toBe(3);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps react mode on the single-run path", async () => {
    const events = await collect(new NativeDriver(), contextWith(stubLlm(["only answer"]), "react"));
    expect(events.filter((event) => event.type === "reflect")).toHaveLength(0);
    expect(extractAnswerFromEvents(events)).toBe("only answer");
  });

  it("emits temp/model/max_steps in the Step-0 config banner", async () => {
    const events = await collect(new NativeDriver(), contextWith(stubLlm(["only answer"]), "react"));
    const banner = events.find((event) => event.type === "thought");
    expect(banner?.content).toContain("temp=0");
    expect(banner?.content).toContain("model=");
    expect(banner?.content).toContain("max_steps=8");
  });
});
