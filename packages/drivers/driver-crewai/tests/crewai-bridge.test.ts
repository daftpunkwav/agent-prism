// @vitest-environment node
/**
 * @file crewai-bridge tests
 * @description Covers host-side bridge behavior: the step budget stops paying for
 *              completions past max_steps, and every completion runs on the arena
 *              prompt assembly (system prompt, context pipeline, prior history).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import type { ArenaEvent, LlmAdapter, LlmInvokeResult, LlmMessage } from "@agentprism/contracts";
import { PipelineConfigSchema, extractAnswerFromEvents } from "@agentprism/contracts";
import { RagStoreCache, createContextAnalytics, type AgentExecutionContext } from "@agentprism/harness";
import { MapToolRegistry } from "@agentprism/tool-registry";
import { TokenTracker } from "@agentprism/telemetry";
import { SystemClock } from "@agentprism/runtime";
import { runCrewaiFrameworkBridge } from "../src/crewai-bridge.js";

const FAKE_BOOTSTRAP = fileURLToPath(new URL("./fake-bootstrap.mjs", import.meta.url));

function contextWith(llm: LlmAdapter, overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  const registry = new MapToolRegistry();
  const names = new Set<string>();
  const workspace = { name: "ws", cwd: () => process.cwd(), fs: {} } as unknown as AgentExecutionContext["workspace"];
  return {
    identity: { agentId: "a", runId: "r" },
    // max_steps 2 → the bridge budget is 2: the third completion must be the note.
    config: PipelineConfigSchema.parse({ label: "col", harness: "bare", max_steps: 2 }),
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
      execute: async () => ({ result: "", fileDiff: null, ok: true }),
    },
    ...overrides,
  } as AgentExecutionContext;
}

describe("runCrewaiFrameworkBridge", () => {
  it("answers over-budget completions with the wrap-up note instead of another model call", async () => {
    let invokeCount = 0;
    const llm: LlmAdapter = {
      invoke: async (): Promise<LlmInvokeResult> => {
        invokeCount += 1;
        return { text: `model-${invokeCount}`, toolCalls: [] };
      },
      async *stream() {},
    };
    const events: ArenaEvent[] = [];
    for await (const event of runCrewaiFrameworkBridge({
      context: contextWith(llm),
      interpreter: process.execPath,
      bootstrapPath: FAKE_BOOTSTRAP,
    })) {
      events.push(event);
    }

    // Exactly two arena model calls; the third completion got the budget note,
    // which the bridge relays on the reflect channel (crewai maps all child
    // events there with the speaker prefix).
    expect(invokeCount).toBe(2);
    const note = events.find(
      (event) => event.type === "reflect" && event.content.includes("[arena] Step budget exhausted"),
    );
    expect(note).toBeDefined();
    const complete = events.at(-1);
    expect(complete?.type).toBe("complete");
    expect(complete?.metrics?.success).toBe(true);
    // The crew's own final output closes the thought channel: role speech rides
    // reflect, so without it the column would report an empty answer.
    expect(extractAnswerFromEvents(events)).toBe("flood done");
  });

  it("runs the crew's completions on the arena prompt, context pipeline and history", async () => {
    vi.stubEnv("FAKE_SCENARIO", "handshake");
    try {
      const messages: LlmMessage[][] = [];
      const llm: LlmAdapter = {
        invoke: async (sent): Promise<LlmInvokeResult> => {
          messages.push([...sent]);
          return { text: "ok", toolCalls: [] };
        },
        async *stream() {},
      };
      const analytics = createContextAnalytics();
      const events: ArenaEvent[] = [];
      for await (const event of runCrewaiFrameworkBridge({
        context: contextWith(llm, {
          history: [{ role: "user", content: "earlier question" }],
          contextAnalytics: analytics,
        }),
        interpreter: process.execPath,
        bootstrapPath: FAKE_BOOTSTRAP,
      })) {
        events.push(event);
      }

      // The run opens with the seeded prompt baseline, like every in-process column.
      const first = events[0];
      expect(first?.type).toBe("token_update");
      expect(first?.token_stats?.total_tokens).toBeGreaterThan(0);

      // First completion: one merged system turn (arena prompt in front of the
      // crew's role copy) + the spliced history + the framework's own task turn.
      const crew = messages[0] ?? [];
      expect(crew.map((message) => message.role)).toEqual(["system", "user", "user"]);
      expect(crew[0]?.content).toContain("[Context: sliding window]");
      expect(crew[0]?.content).toContain("[CrewAI Researcher] role copy");
      expect(crew[1]?.content).toBe("earlier question");
      expect(crew[2]?.content).toBe("do the task");
      expect(analytics.usage.size).toBeGreaterThanOrEqual(messages.length);
      // History is the first completion's alone.
      const later = messages[1] ?? [];
      expect(later.some((message) => message.content === "earlier question")).toBe(false);
      // The handshake task is the assembled user part (question + cwd grounding).
      expect(
        events.some(
          (event) =>
            event.type === "reflect" &&
            event.content.includes("task:") &&
            event.content.includes("Current working directory"),
        ),
      ).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("feeds the drift guard the transcript's prior tool calls", async () => {
    vi.stubEnv("FAKE_SCENARIO", "drift");
    try {
      const executed: string[] = [];
      // The guard needs a lexical anchor in the question (≥3 Latin tokens) and a
      // guarded harness level; the call must be authorized to reach it.
      const llm: LlmAdapter = { invoke: async () => ({ text: "", toolCalls: [] }), async *stream() {} };
      const context = contextWith(llm, {
        question: "write the hello script file",
        config: PipelineConfigSchema.parse({ label: "col", harness: "reflect", max_steps: 8 }),
      });
      context.tools.names = new Set(["bash"]);
      context.tools.execute = async (name: string) => {
        executed.push(name);
        return { result: "ran", fileDiff: null, ok: true };
      };
      const events: ArenaEvent[] = [];
      for await (const event of runCrewaiFrameworkBridge({
        context,
        interpreter: process.execPath,
        bootstrapPath: FAKE_BOOTSTRAP,
      })) {
        events.push(event);
      }

      // The unrelated call never reached tools.execute; the guard's block message
      // (anchored on the question) travelled back to the crew.
      expect(executed).toEqual([]);
      const outcome = events.find(
        (event) => event.type === "reflect" && event.content.includes("outcome:"),
      );
      expect(outcome?.content).toContain("write the hello script file");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
