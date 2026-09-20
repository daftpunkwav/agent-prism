/**
 * @file ArenaRunner column session tests
 * @description Verifies ArenaRunner keeps column sessions independent.
 *
 * Responsibilities:
 * - Run each column with an isolated transcript and workspace
 * - Catch cross-column transcript leakage
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  completeEvent,
  type AgentDriver,
  type ArenaEvent,
  type ArenaRunRequest,
  type ChatMessage,
  type PipelineConfig,
  type PipelineMetrics,
} from "@agentprism/contracts";
import { FrameworkDriverRegistry } from "@agentprism/driver-registry";
import { WorkspaceRegistry, type Workspace } from "@agentprism/runtime";
import { ArenaRunner } from "@agentprism/arena-runner";

function makeMetrics(): PipelineMetrics {
  return {
    success: true,
    duration_ms: 10,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    tool_calls: 1,
    steps: 1,
    context_window: 128_000,
    max_input_tokens: 120_000,
    max_output_tokens: 4096,
    context_usage_pct: 0,
    input_usage_pct: 0,
  };
}

type Captured = {
  history: ChatMessage[];
  workspace: string;
  marker: string;
};

function makeCaptureDriver(captured: Map<string, Captured>): AgentDriver {
  return {
    frameworkId: "fake",
    displayName: "Fake",
    async *run(raw: unknown): AsyncIterable<ArenaEvent> {
      const context = raw as {
        config: { label: string };
        history: ChatMessage[];
        workspace: Workspace;
        turn: number;
      };
      const label = context.config.label;
      const workspace = context.workspace;
      workspace.fs.writeFile("marker.txt", label);
      let marker = "";
      try {
        marker = workspace.fs.readFile("marker.txt");
      } catch {
        marker = "";
      }
      captured.set(label, {
        history: [...context.history],
        workspace: workspace.name,
        marker,
      });
      yield completeEvent({
        pipeline: label,
        workspace: workspace.name,
        metrics: makeMetrics(),
        turn: context.turn,
      });
    },
  };
}

function makeRequest(overrides: Partial<ArenaRunRequest> = {}): ArenaRunRequest {
  return {
    question: overrides.question ?? "write snake",
    dimension: "framework",
    selections: ["native", "langchain"],
    messages: overrides.messages ?? [],
    temperature: null,
    baseline: null,
    column_sessions: overrides.column_sessions,
  } as ArenaRunRequest;
}

describe("ArenaRunner independent column sessions", () => {
  const runsRoot = join(tmpdir(), `aprism-sessions-${randomUUID()}`);
  mkdirSync(runsRoot, { recursive: true });

  afterEach(() => {
    rmSync(runsRoot, { recursive: true, force: true });
    mkdirSync(runsRoot, { recursive: true });
  });

  it("gives each column its own history and reuses that column's workspace on follow-up", async () => {
    const captured = new Map<string, Captured>();
    const registry = new FrameworkDriverRegistry();
    registry.register(makeCaptureDriver(captured));
    const workspaces = new WorkspaceRegistry({
      runsRoot,
      maxWorkspaces: 8,
      ttlSeconds: 3600,
      clock: { now: () => 0 },
    });
    const runner = new ArenaRunner({
      registry,
      router: {
        route: (): PipelineConfig[] =>
          [
            { label: "Native Agent", endpoint_id: "ep", framework: "fake", harness: "bare" },
            { label: "LangChain", endpoint_id: "ep", framework: "fake", harness: "bare" },
          ] as PipelineConfig[],
      } as never,
      workspaceRegistry: workspaces,
      reportPublisher: { publish: async () => null },
      modelFactory: {
        create: () => ({
          llm: { invoke: async () => ({ text: "", toolCalls: [] }), stream: async function* () {} },
          llmVendor: {},
          contextWindow: 128_000,
          maxInputTokens: 120_000,
        }),
      },
      idGenerator: { next: () => randomUUID().slice(0, 8) },
      clock: { now: () => 0 },
      maxConcurrentRuns: 2,
    });

    const firstEvents: ArenaEvent[] = [];
    for await (const event of runner.streamParallel(makeRequest())) firstEvents.push(event);

    const nativeWs = firstEvents.find((e) => e.type === "complete" && e.pipeline === "Native Agent")?.workspace;
    const lcWs = firstEvents.find((e) => e.type === "complete" && e.pipeline === "LangChain")?.workspace;
    expect(nativeWs).toBeTruthy();
    expect(lcWs).toBeTruthy();
    expect(nativeWs).not.toBe(lcWs);
    expect(captured.get("Native Agent")?.history).toEqual([]);
    expect(captured.get("LangChain")?.history).toEqual([]);
    expect(captured.get("Native Agent")?.marker).toBe("Native Agent");
    expect(captured.get("LangChain")?.marker).toBe("LangChain");

    captured.clear();
    const followUp: ArenaRunRequest = makeRequest({
      question: "add a scoreboard",
      column_sessions: {
        "Native Agent": {
          workspace: nativeWs,
          messages: [
            { role: "user", content: "write snake" },
            { role: "assistant", content: "created snake.py in native layout" },
          ],
        },
        LangChain: {
          workspace: lcWs,
          messages: [
            { role: "user", content: "write snake" },
            { role: "assistant", content: "created snake.py in langchain layout" },
          ],
        },
      },
    });

    for await (const _event of runner.streamParallel(followUp)) {
      // Drain the follow-up stream; assertions use the captured driver contexts.
    }

    expect(captured.get("Native Agent")?.workspace).toBe(nativeWs);
    expect(captured.get("LangChain")?.workspace).toBe(lcWs);
    expect(captured.get("Native Agent")?.history[1]?.content).toContain("native layout");
    expect(captured.get("LangChain")?.history[1]?.content).toContain("langchain layout");
    expect(captured.get("Native Agent")?.history[1]?.content).not.toContain("langchain layout");
    expect(captured.get("LangChain")?.marker).toBe("LangChain");
  });
});
