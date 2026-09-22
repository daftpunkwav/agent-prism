/**
 * @file memory test
 * @description Locks cross-session memory recall/record wiring in runAgentExecution.
 */

import { describe, expect, it } from "vitest";
import { PipelineConfigSchema, type EpisodicMemoryEntry, type MemoryServicePort, type SemanticFact } from "@agentprism/contracts";
import type { AgentExecutionContext } from "@agentprism/harness";
import { captureDriver, collect, testDeps, testSpec } from "./run-fixtures.js";

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
