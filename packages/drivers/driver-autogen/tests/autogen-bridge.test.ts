// @vitest-environment node
/**
 * @file autogen-bridge tests
 * @description Covers the Python bridge wiring against a fake bootstrap: the
 *              llm handler binds the arena definitions the bootstrap forwards
 *              (and leaves tool-less reviewer turns unbound), coder events ride
 *              the thought channel, and bootstrapScriptPath resolves the bundled
 *              script relative to the caller's module URL.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import type { ArenaEvent, LlmAdapter, LlmCallOptions, LlmInvokeResult, LlmMessage, ToolDefinition } from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import { RagStoreCache, createContextAnalytics, type AgentExecutionContext } from "@agentprism/harness";
import { MapToolRegistry } from "@agentprism/tool-registry";
import { TokenTracker } from "@agentprism/telemetry";
import { SystemClock } from "@agentprism/runtime";
import { bootstrapScriptPath, runAutogenFrameworkBridge } from "../src/autogen-bridge.js";

const FAKE_BOOTSTRAP = fileURLToPath(new URL("./fake-bootstrap.mjs", import.meta.url));

function readTool(): ToolDefinition {
  return {
    name: "read",
    description: "read",
    jsonSchema: { type: "object", properties: {} },
    mutatesWorkspace: false,
    execute: async () => ({ result: "file content here", fileDiff: null, ok: true }),
  };
}

function contextWith(llm: LlmAdapter, overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  const registry = new MapToolRegistry();
  registry.register(readTool());
  const names = new Set(["read"]);
  const workspace = { name: "ws", cwd: () => process.cwd(), fs: {} } as unknown as AgentExecutionContext["workspace"];
  return {
    identity: { agentId: "a", runId: "r" },
    config: PipelineConfigSchema.parse({ label: "col", harness: "bare", max_steps: 16 }),
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
      execute: (name: string, args: Record<string, unknown>) => registry.execute(workspace, name, args, { authorizedNames: names }),
    },
    ...overrides,
  } as AgentExecutionContext;
}

describe("runAutogenFrameworkBridge", () => {
  it("binds the forwarded arena tools on completions and keeps tool-less turns unbound", async () => {
    const calls: Array<LlmCallOptions | undefined> = [];
    const llm: LlmAdapter = {
      invoke: async (_messages, options) => {
        calls.push(options);
        return { text: `reply-${calls.length}`, toolCalls: [] };
      },
      async *stream() {},
    };
    const events: ArenaEvent[] = [];
    for await (const event of runAutogenFrameworkBridge({
      context: contextWith(llm),
      interpreter: process.execPath,
      bootstrapPath: FAKE_BOOTSTRAP,
    })) {
      events.push(event);
    }

    // Coder turn: the bootstrap forwarded the handshake catalog, so the arena
    // "read" definition must be bound for the call.
    expect(calls[0]?.tools?.map((definition) => definition.name)).toEqual(["read"]);
    // Reviewer turn: empty forwarded list — nothing bound.
    expect(calls[1]?.tools).toBeUndefined();
    // Coder events ride the thought channel with the handshake catalog echo.
    expect(events.some((event) => event.type === "thought" && event.content === "catalog:read")).toBe(true);
    const complete = events.at(-1);
    expect(complete?.type).toBe("complete");
    expect(complete?.metrics?.success).toBe(true);
  });

  it("runs the child's completions on the arena prompt, context pipeline and history", async () => {
    const messages: LlmMessage[][] = [];
    const llm: LlmAdapter = {
      invoke: async (sent) => {
        messages.push([...sent]);
        return { text: "ok", toolCalls: [] };
      },
      async *stream() {},
    };
    const analytics = createContextAnalytics();
    const context = contextWith(llm, {
      history: [
        { role: "user", content: "earlier question" },
        { role: "assistant", content: "earlier answer" },
      ],
      contextAnalytics: analytics,
    });
    const events: ArenaEvent[] = [];
    for await (const event of runAutogenFrameworkBridge({
      context,
      interpreter: process.execPath,
      bootstrapPath: FAKE_BOOTSTRAP,
    })) {
      events.push(event);
    }

    // The run opens with the seeded prompt baseline, like every in-process column.
    const first = events[0];
    expect(first?.type).toBe("token_update");
    expect(first?.token_stats?.total_tokens).toBeGreaterThan(0);

    // First completion: arena system prompt + prior turns + the task turn the
    // child sent. The child's role copy rides behind the arena prompt.
    const coder = messages[0] ?? [];
    expect(coder.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(coder[0]?.content).toContain("[Context: sliding window]");
    expect(coder[1]?.content).toBe("earlier question");
    expect(coder[2]?.content).toBe("earlier answer");
    // The child's task turn is the assembled user part (question + cwd grounding),
    // not the bare question.
    expect(coder[3]?.content).toContain("write hi.txt");
    expect(coder[3]?.content).toContain("Current working directory");
    // The context pipeline prepared every completion (one ledger row per call).
    expect(analytics.usage.size).toBeGreaterThanOrEqual(messages.length);
    // History belongs to the conversation's first completion only.
    const reviewer = messages[1] ?? [];
    expect(reviewer.some((message) => message.content === "earlier question")).toBe(false);
    // The handshake carried that assembled task text into the framework (the fake
    // echoes the handshake question back as reviewer speech).
    expect(
      events.some(
        (event) =>
          event.type === "reflect" &&
          event.content.includes("task:") &&
          event.content.includes("Current working directory"),
      ),
    ).toBe(true);
  });

  it("feeds the drift guard the transcript's prior tool calls", async () => {
    vi.stubEnv("FAKE_SCENARIO", "drift");
    try {
      const executed: string[] = [];
      // The guard needs a lexical anchor in the question (≥3 Latin tokens) and a
      // guarded harness level ("bare" disables the guard entirely).
      const question = "write the hello script file";
      const context = contextWith(
        { invoke: async () => ({ text: "", toolCalls: [] }), async *stream() {} },
        { question },
      );
      // The call must be authorized to reach the guard (authorization runs first).
      context.tools = { ...context.tools, names: new Set([...context.tools.names, "bash"]) };
      context.tools.execute = async (name: string) => {
        executed.push(name);
        return { result: "ran", fileDiff: null, ok: true };
      };
      context.config = PipelineConfigSchema.parse({ label: "col", harness: "reflect", max_steps: 8 });
      const events: ArenaEvent[] = [];
      for await (const event of runAutogenFrameworkBridge({
        context,
        interpreter: process.execPath,
        bootstrapPath: FAKE_BOOTSTRAP,
      })) {
        events.push(event);
      }

      // The unrelated call never reached tools.execute, and the block message
      // (which the guard anchors on the question) came back to the framework.
      expect(executed).toEqual([]);
      const outcome = events.find((event) => event.type === "reflect" && event.content.startsWith("[AutoGen reviewer] outcome:"));
      expect(outcome?.content).toContain(question);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("bootstrapScriptPath", () => {
  it("resolves the bundled python script relative to the caller's module URL", () => {
    expect(bootstrapScriptPath(import.meta.url).replaceAll("\\", "/")).toMatch(/\/python\/bootstrap\.py$/);
  });
});
