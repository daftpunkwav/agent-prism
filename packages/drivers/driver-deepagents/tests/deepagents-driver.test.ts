/**
 * @file deepagents driver tests
 * @description Runs DeepAgentsDriver end to end on a scripted chat model.
 *
 * Responsibilities:
 * - Pin the happy path event arc: banner → streamed output → complete(success)
 * - Pin the error path: model failure converges into error + complete(success=false)
 *
 * The agent loop is the real createDeepAgent middleware stack; the model is a
 * scripted BaseChatModel subclass (no network, no SDK mocks).
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { Runnable } from "@langchain/core/runnables";
import type { ArenaEvent, PipelineConfig } from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import type { AgentExecutionContext } from "@agentprism/harness";
import { WorkspaceRegistry } from "@agentprism/runtime";
import { TokenTracker } from "@agentprism/telemetry";
import { createBuiltinToolRegistry } from "@agentprism/tool-builtins";
import {
  DEEPAGENTS_RESERVED_TOOL_NAMES,
  READ_ONLY_FILESYSTEM_TOOLS,
  DeepAgentsDriver,
  bindableDefinitions,
} from "../src/deepagents-driver.js";

/** Chat model yielding one scripted AIMessage per call (never tool-calls). */
class ScriptedChatModel extends BaseChatModel {
  private idx = 0;

  constructor(private readonly responses: AIMessage[]) {
    super({});
  }

  override _llmType(): string {
    return "scripted";
  }

  /** The deep-agent middleware binds tools; identity binding suffices for a no-tool script. */
  override bindTools(): Runnable {
    return this;
  }

  override async _generate(
    _messages: BaseMessage[],
    _options?: Record<string, unknown>,
  ): Promise<ChatResult> {
    const message = this.responses[Math.min(this.idx, this.responses.length - 1)]!;
    this.idx += 1;
    return { generations: [{ text: String(message.content ?? ""), message }] };
  }

  override async *_streamResponseChunks(_messages: BaseMessage[]): AsyncGenerator<ChatGenerationChunk> {
    const message = this.responses[Math.min(this.idx, this.responses.length - 1)]!;
    this.idx += 1;
    yield new ChatGenerationChunk({
      message: new AIMessageChunk({ content: message.content }),
      text: String(message.content ?? ""),
    });
  }
}

/** Real workspace under a throwaway runs root (buildSystemUser reads cwd/fs). */
function executionContext(
  model: unknown,
  overrides: Partial<AgentExecutionContext> = {},
): AgentExecutionContext & { cleanup: () => void } {
  const registry = createBuiltinToolRegistry();
  const config: PipelineConfig = PipelineConfigSchema.parse({ label: "col", harness: "bare" });
  const runsRoot = mkdtempSync(join(tmpdir(), "deepagents-driver-"));
  const workspace = new WorkspaceRegistry({ runsRoot, clock: { now: () => 1_700_000_000_000 } }).create("ws");
  const context = {
    identity: { agentId: "a1" } as AgentExecutionContext["identity"],
    config,
    question: "What is 2+2?",
    history: [],
    turn: 1,
    workspace,
    tracker: new TokenTracker(),
    clock: { now: () => 1_700_000_000_000 },
    rag: {} as AgentExecutionContext["rag"],
    llm: {} as AgentExecutionContext["llm"],
    llmVendor: model,
    tools: {
      // The real registry: its full tool set is what the framework's reserved-name
      // check runs against, so an empty stub would hide a collision.
      registry,
      names: new Set(registry.listDefinitions().map((definition) => definition.name)),
      execute: async () => ({ result: "ok", fileDiff: null, ok: true }),
    },
    ...overrides,
  } as AgentExecutionContext & { cleanup: () => void };
  context.cleanup = () => rmSync(runsRoot, { recursive: true, force: true });
  return context;
}

async function collect(generator: AsyncGenerator<ArenaEvent>): Promise<ArenaEvent[]> {
  const events: ArenaEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

describe("DeepAgentsDriver", () => {
  it("declares the framework id and display name the registry and banner map use", () => {
    const driver = new DeepAgentsDriver();
    expect(driver.frameworkId).toBe("deepagents");
    expect(driver.displayName).toBe("Deep Agents");
  });

  it("emits the banner, streamed answer, and a successful complete event", { timeout: 60_000 }, async () => {
    const driver = new DeepAgentsDriver();
    const model = new ScriptedChatModel([new AIMessage("The answer is 4.")]);
    const context = executionContext(model);
    try {
      const events = await collect(driver.run(context));
      expect(events[0]?.type).toBe("token_update");
      const banner = events.find((event) => event.type === "thought" && event.content.includes("Deep Agents"));
      expect(banner).toBeDefined();
      // The compare table unions key=value fields: reasoning/prompt must be keyed, never bare modes.
      expect(banner?.content).toContain("prompt=");
      expect(banner?.content).toContain("reasoning=");
      // The scripted text must reach the answer channel (thought deltas), not just the terminal.
      const streamed = events
        .filter((event) => event.type === "thought_delta")
        .map((event) => (event as ArenaEvent & { content: string }).content)
        .join("");
      expect(streamed).toContain("The answer is 4.");
      expect(events.some((event) => event.type === "error")).toBe(false);
      const terminal = events.at(-1);
      expect(terminal?.type).toBe("complete");
      expect((terminal as ArenaEvent & { metrics: { success: boolean } }).metrics.success).toBe(true);
    } finally {
      context.cleanup();
    }
  });

  it("converges model failure into an error event followed by an unsuccessful complete", { timeout: 60_000 }, async () => {
    const driver = new DeepAgentsDriver();
    // Duck-typed vendor object: passes requireChatModel and the framework's model
    // name probe, then fails inside the graph run (the arc this test locks).
    const exploding = {
      getName: () => "exploding",
      invoke: async () => {
        throw new Error("model exploded with credentials");
      },
      stream: async function* () {
        throw new Error("model exploded with credentials");
      },
    };
    const context = executionContext(exploding);
    try {
      const events = await collect(driver.run(context));
      expect(events.some((event) => event.type === "error" && !event.message.includes("credentials"))).toBe(true);
      const terminal = events.at(-1);
      expect(terminal?.type).toBe("complete");
      expect((terminal as ArenaEvent & { metrics: { success: boolean } }).metrics.success).toBe(false);
    } finally {
      context.cleanup();
    }
  });
});

describe("reserved tool names and read-only filesystem scope", () => {
  it("drops exactly the registry tools the framework reserves", () => {
    const registry = createBuiltinToolRegistry();
    const tools = {
      registry,
      names: new Set(registry.listDefinitions().map((definition) => definition.name)),
      execute: async () => ({ result: "", fileDiff: null, ok: true }),
    };
    const bound = bindableDefinitions(tools).map((definition) => definition.name);
    for (const reserved of DEEPAGENTS_RESERVED_TOOL_NAMES) {
      expect(bound).not.toContain(reserved);
      // The framework's own read-only version covers the dropped operation.
      expect(READ_ONLY_FILESYSTEM_TOOLS).toContain(reserved === "ls" ? "ls" : reserved);
    }
    expect(bound).toContain("read");
    expect(bound).toContain("write");
    expect(bound).toContain("bash");
    // read_file is mandatory for the framework's filesystem middleware.
    expect(READ_ONLY_FILESYSTEM_TOOLS).toContain("read_file");
    // No write/edit tool is handed to the framework's own filesystem layer.
    expect(READ_ONLY_FILESYSTEM_TOOLS).not.toContain("write_file");
    expect(READ_ONLY_FILESYSTEM_TOOLS).not.toContain("edit_file");
  });
});
