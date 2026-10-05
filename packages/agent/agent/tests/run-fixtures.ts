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
/**
 * Driver that converges internally the way the real backends do: it yields an error
 * event and a `complete(success:false)`, then RETURNS normally. The agent layer must
 * read that terminal state, not "did an exception escape".
 */
export function convergingFailureDriver(): AgentDriver {
  return {
    frameworkId: "stub",
    displayName: "Stub",
    async *run(): AsyncGenerator<ArenaEvent> {
      yield { type: "error", pipeline: "col", message: "provider 503" } as ArenaEvent;
      yield {
        type: "complete",
        pipeline: "col",
        metrics: { success: false, duration_ms: 1, input_tokens: 0, output_tokens: 0, total_tokens: 0, tool_calls: 0, steps: 1, context_window: 1, max_input_tokens: 1, max_output_tokens: 1, context_usage_pct: 0, input_usage_pct: 0 },
      } as ArenaEvent;
    },
  };
}

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
      yield* [];
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
