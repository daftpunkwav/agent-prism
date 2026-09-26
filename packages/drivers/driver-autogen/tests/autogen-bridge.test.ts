// @vitest-environment node
/**
 * @file autogen-bridge tests
 * @description Covers the Python bridge wiring against a fake bootstrap: the
 *              llm handler binds the arena definitions the bootstrap forwards
 *              (and leaves tool-less reviewer turns unbound), coder events ride
 *              the thought channel, and bootstrapScriptPath resolves the bundled
 *              script relative to the caller's module URL.
 */

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { ArenaEvent, LlmAdapter, LlmCallOptions, LlmInvokeResult, ToolDefinition } from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import { RagStoreCache, type AgentExecutionContext } from "@agentprism/harness";
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

function contextWith(llm: LlmAdapter): AgentExecutionContext {
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
});

describe("bootstrapScriptPath", () => {
  it("resolves the bundled python script relative to the caller's module URL", () => {
    expect(bootstrapScriptPath(import.meta.url).replaceAll("\\", "/")).toMatch(/\/python\/bootstrap\.py$/);
  });
});
