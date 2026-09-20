/**
 * @file arena breaker tests
 * @description Locks breaker accounting for error-terminated columns.
 *
 * Responsibilities:
 * - Trip the breaker under repeated endpoint failures and short-circuit afterwards
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { arenaErrorEvent, type ArenaEvent, type ArenaRunRequest, type PipelineConfig } from "@agentprism/contracts";
import type { AgentDriver } from "@agentprism/contracts";
import { FrameworkDriverRegistry } from "@agentprism/driver-registry";
import { WorkspaceRegistry } from "@agentprism/runtime";
import { ArenaRunner } from "@agentprism/arena-runner";

/** Fake driver: emits a single error event (downstream LLM failure digested by the agent layer). */
function makeFailingDriver(): AgentDriver {
  return {
    frameworkId: "fake",
    displayName: "Fake",
    async *run(): AsyncIterable<ArenaEvent> {
      yield arenaErrorEvent({
        pipeline: "fail-column",
        message: "LLM failed",
        turn: 1,
        runId: "r",
        timestamp: 0,
        agentId: "a",
      });
    },
  };
}

function makeConfig(label = "fail-column"): PipelineConfig {
  return { label, endpoint_id: "ep-breaker", framework: "fake" } as PipelineConfig;
}

function makeRequest(): ArenaRunRequest {
  return {
    question: "test question",
    dimension: "framework",
    selections: [],
    messages: [],
    temperature: null,
    baseline: null,
  } as unknown as ArenaRunRequest;
}

describe("ArenaRunner breaker", () => {
  const runsRoot = join(tmpdir(), `aprism-breaker-${randomUUID()}`);
  mkdirSync(runsRoot, { recursive: true });

  afterEach(() => {
    rmSync(runsRoot, { recursive: true, force: true });
  });

  it("columns ending in error count toward the breaker; after threshold, short-circuit without calling the model factory", async () => {
    const registry = new FrameworkDriverRegistry();
    registry.register(makeFailingDriver());
    let createCount = 0;
    const workspaces = new WorkspaceRegistry({ runsRoot, maxWorkspaces: 8, ttlSeconds: 3600, clock: { now: () => 0 } });
    const runner = new ArenaRunner({
      registry,
      router: { route: (): PipelineConfig[] => [makeConfig()] } as never,
      workspaceRegistry: workspaces,
      reportPublisher: {
        publish: async () => null,
      },
      modelFactory: {
        create: () => {
          createCount += 1;
          return {
            llm: { invoke: async () => ({ text: "", toolCalls: [] }), stream: async function* () {} },
            llmVendor: {},
            contextWindow: 128_000,
            maxInputTokens: 120_000,
          };
        },
      },
      idGenerator: { next: () => randomUUID().slice(0, 8) },
      clock: { now: () => 0 },
      maxConcurrentRuns: 2,
    });

    const request = makeRequest();

    // First 3: driver and model factory are called; column ends with error
    for (let round = 0; round < 3; round += 1) {
      const events: ArenaEvent[] = [];
      for await (const event of runner.streamParallel(request)) events.push(event);
      expect(events.some((e) => e.type === "error" && e.message === "LLM failed")).toBe(true);
    }
    expect(createCount).toBe(3);

    // 4th: circuit short-circuits; model factory and driver are not touched
    const shortCircuited: ArenaEvent[] = [];
    for await (const event of runner.streamParallel(request)) shortCircuited.push(event);
    expect(createCount).toBe(3);
    expect(shortCircuited.some((e) => e.type === "error" && e.message.includes("circuit-broken"))).toBe(true);
  });
});
