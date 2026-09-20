/**
 * @file run fixtures
 * @description Shared runAgentExecution scaffolding: deps, specs, and driver stubs.
 *
 * Responsibilities:
 * - Build isolated registries, specs, and context-capturing drivers
 *
 * Support module, not a test: picked up by no runner (no .test suffix).
 */

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach } from "vitest";
import type { AgentDriver, ArenaEvent, ColumnRuntime, PipelineConfig } from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import type { AgentExecutionContext } from "@agentprism/harness";
import { RandomIdGenerator, SystemClock, WorkspaceRegistry } from "@agentprism/runtime";
import { runAgentExecution, type AgentExecutionDeps, type AgentRunSpec } from "../src/agent-execution.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop() as string;
    rmSync(root, { recursive: true, force: true });
  }
});

export function testDeps(): AgentExecutionDeps {
  const runsRoot = join(tmpdir(), `aprism-agent-policy-${randomUUID()}`);
  roots.push(runsRoot);
  const clock = new SystemClock();
  return {
    workspaceRegistry: new WorkspaceRegistry({ runsRoot, clock }),
    idGenerator: new RandomIdGenerator(),
    clock,
  };
}

export function testSpec(driver: AgentDriver, overrides: Partial<AgentRunSpec> = {}): AgentRunSpec {
  const config: PipelineConfig = PipelineConfigSchema.parse({ label: "col", harness: "bare" });
  const columnRuntime: ColumnRuntime = {
    llm: { invoke: async () => ({}) } as unknown as ColumnRuntime["llm"],
    llmVendor: null,
    contextWindow: 128000,
    maxInputTokens: 120000,
  };
  return {
    driver,
    config,
    question: "q",
    history: [],
    turn: 1,
    agentId: "a1",
    runId: "r1",
    columnRuntime,
    ...overrides,
  };
}

/** Driver stub that exposes its execution context, then ends silently or throws. */
export function captureDriver(
  onContext: (ctx: AgentExecutionContext) => void,
  failure?: Error,
): AgentDriver {
  return {
    frameworkId: "stub",
    displayName: "Stub",
    async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
      onContext(ctx);
      if (failure !== undefined) throw failure;
    },
  };
}

export async function collect(deps: AgentExecutionDeps, spec: AgentRunSpec): Promise<ArenaEvent[]> {
  const events: ArenaEvent[] = [];
  for await (const event of runAgentExecution(deps, spec)) {
    events.push(event);
  }
  return events;
}

export function terminalWorkspace(events: ArenaEvent[], type: "complete" | "error"): string {
  const terminal = events.find((event) => event.type === type);
  if (terminal === undefined) throw new Error(`expected a ${type} event`);
  return terminal.workspace;
}
