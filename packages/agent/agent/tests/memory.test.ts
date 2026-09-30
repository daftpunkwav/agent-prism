/**
 * @file memory test
 * @description Locks cross-session memory recall/record wiring in runAgentExecution.
 */

import { describe, expect, it, vi } from "vitest";
import { PipelineConfigSchema, type EpisodicMemoryEntry, type MemoryServicePort, type SemanticFact } from "@agentprism/contracts";
import type { AgentExecutionContext } from "@agentprism/harness";
import { captureDriver, collect, convergingFailureDriver, testDeps, testSpec } from "./run-fixtures.js";

/** In-memory stub of the contracts memory port, recording every call. */
function stubMemory(): MemoryServicePort & {
  recalls: string[];
  records: Array<Omit<EpisodicMemoryEntry, "id" | "timestamp">>;
} {
  const recalls: string[] = [];
  const records: Array<Omit<EpisodicMemoryEntry, "id" | "timestamp">> = [];
  return {
    recalls,
    records,
    async recordEpisodic(entry) {
      records.push(entry);
      return { ...entry, id: "ep-test", timestamp: 1 };
    },
    async recallEpisodic(taskQuery: string) {
      recalls.push(`episodic:${taskQuery}`);
      return [
        {
          id: "ep-1",
          task: "past task",
          framework: "native",
          model: "m",
          success: true,
          keyActions: ["bash"],
          lessons: "try node instead of python",
          timestamp: 1,
          workspaceTag: "",
        },
      ];
    },
    async recordSemantic(fact: Omit<SemanticFact, "id">) {
      return { ...fact, id: "sem-test" };
    },
    async recallSemantic(query: string) {
      recalls.push(`semantic:${query}`);
      return [
        { id: "sem-1", subject: "project", predicate: "uses", object: "vitest", confidence: 1, validFrom: 0, source: "" },
      ];
    },
    async recallAll(query: string) {
      recalls.push(`all:${query}`);
      return {
        episodic: [...(await this.recallEpisodic(query))],
        semantic: [...(await this.recallSemantic(query))],
      };
    },
  };
}

/** In-memory stub whose every recall rejects (memory backend down). */
function rejectingMemory(message: string): MemoryServicePort & {
  records: Array<Omit<EpisodicMemoryEntry, "id" | "timestamp">>;
} {
  const records: Array<Omit<EpisodicMemoryEntry, "id" | "timestamp">> = [];
  const reject = async (): Promise<never> => {
    throw new Error(message);
  };
  return {
    records,
    async recordEpisodic(entry) {
      records.push(entry);
      return { ...entry, id: "ep-test", timestamp: 1 };
    },
    recallEpisodic: reject,
    async recordSemantic(fact: Omit<SemanticFact, "id">) {
      return { ...fact, id: "sem-test" };
    },
    recallSemantic: reject,
    recallAll: reject,
  };
}

describe("memory wiring", () => {
  it("mounts episodic recall into the context and settles one post-mortem", async () => {
    const deps = testDeps();
    const memory = stubMemory();
    let seen: AgentExecutionContext | null = null;
    await collect(deps, testSpec(captureDriver((ctx) => { seen = ctx; }), {
      config: PipelineConfigSchema.parse({ label: "col", harness: "bare", memory: "episodic" }),
      memory,
    }));
    expect((seen as unknown as AgentExecutionContext).memoryRecall?.episodic).toHaveLength(1);
    expect((seen as unknown as AgentExecutionContext).memoryRecall?.semantic).toHaveLength(0);
    expect(memory.recalls).toEqual(["episodic:q"]);
    expect(memory.records).toHaveLength(1);
    expect(memory.records[0]?.success).toBe(true);
    expect(memory.records[0]?.task).toBe("q");
  });

  it("stays stateless when no service is injected", async () => {
    const deps = testDeps();
    let seen: AgentExecutionContext | null = null;
    await collect(deps, testSpec(captureDriver((ctx) => { seen = ctx; }), {
      config: PipelineConfigSchema.parse({ label: "col", harness: "bare", memory: "full" }),
    }));
    expect((seen as unknown as AgentExecutionContext).memoryRecall).toBeUndefined();
  });

  it("stays stateless for policy none even when a service is injected", async () => {
    // A globally wired memory service with a column that opted out is a real
    // deployment shape: the per-run policy must win over the injected port.
    const deps = testDeps();
    const memory = stubMemory();
    let seen: AgentExecutionContext | null = null;
    await collect(deps, testSpec(captureDriver((ctx) => { seen = ctx; }), {
      config: PipelineConfigSchema.parse({ label: "col", harness: "bare", memory: "none" }),
      memory,
    }));
    expect((seen as unknown as AgentExecutionContext).memoryRecall).toBeUndefined();
    expect(memory.recalls).toEqual([]);
    expect(memory.records).toEqual([]);
  });

  it("keeps the run stateless when the memory backend rejects recall", async () => {
    // Degradation path: a dead memory backend must not take the top-level run
    // down with it. The run completes, the recall resolves empty, and the skip
    // is logged loudly; the post-mortem write is independent of recall health.
    const deps = testDeps();
    const memory = rejectingMemory("memory backend unreachable");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let seen: AgentExecutionContext | null = null;
    const events = await collect(deps, testSpec(captureDriver((ctx) => { seen = ctx; }), {
      config: PipelineConfigSchema.parse({ label: "col", harness: "bare", memory: "episodic" }),
      memory,
    }));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("memory recall skipped"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("memory backend unreachable"));
    warn.mockRestore();
    expect((seen as unknown as AgentExecutionContext).memoryRecall).toBeUndefined();
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(events.some((e) => e.type === "complete")).toBe(true);
    expect(memory.records).toHaveLength(1);
  });

  it("records an internally converged failure as unsuccessful", async () => {
    // The backends converge their own failures into error + complete(success:false) and
    // return normally; the recorded experience must follow that terminal state, not the
    // absence of a thrown exception.
    const deps = testDeps();
    const memory = stubMemory();
    await collect(deps, testSpec(convergingFailureDriver(), {
      config: PipelineConfigSchema.parse({ label: "col", harness: "bare", memory: "full" }),
      memory,
    }));
    expect(memory.records).toHaveLength(1);
    expect(memory.records[0]?.success).toBe(false);
  });

  it("records failed runs as unsuccessful experiences without failing the run", async () => {
    const deps = testDeps();
    const memory = stubMemory();
    const events = await collect(deps, testSpec(captureDriver(() => {}, new Error("boom")), {
      config: PipelineConfigSchema.parse({ label: "col", harness: "bare", memory: "full" }),
      memory,
    }));
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events.some((e) => e.type === "complete")).toBe(true);
    expect(memory.records).toHaveLength(1);
    expect(memory.records[0]?.success).toBe(false);
  });
});
