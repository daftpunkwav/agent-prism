/**
 * @file langchain driver run tests
 * @description Runs LangChainDriver end to end on a scripted chat model.
 *
 * Responsibilities:
 * - Pin the happy path event arc: banner → streamed output → complete(success)
 * - Pin the error path: model failure converges into error + complete(success=false)
 *
 * The agent loop is the real langchain createAgent; the model is a scripted
 * BaseChatModel subclass (no network, no SDK mocks).
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { Runnable } from "@langchain/core/runnables";
import type { ArenaEvent, PipelineConfig } from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import type { AgentExecutionContext } from "@agentprism/harness";
import { WorkspaceRegistry } from "@agentprism/runtime";
import { LangChainDriver } from "../src/langchain-driver.js";
import { TokenTracker } from "@agentprism/telemetry";

/** Chat model yielding one scripted AIMessage per call (never tool-calls). */
class ScriptedChatModel extends BaseChatModel {
  private responses: AIMessage[];
  private idx = 0;

  constructor(responses: AIMessage[]) {
    super({});
    this.responses = responses;
  }

  override _llmType(): string {
    return "scripted";
  }

  /** createAgent requires bindTools even for an empty toolset; identity binding suffices. */
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

  override async *_streamResponseChunks(
    _messages: BaseMessage[],
  ): AsyncGenerator<ChatGenerationChunk> {
    const message = this.responses[Math.min(this.idx, this.responses.length - 1)]!;
    this.idx += 1;
    yield new ChatGenerationChunk({
      message: new AIMessageChunk({ content: message.content }),
      text: String(message.content ?? ""),
    });
  }
}

/** Real workspace under a throwaway runs root (buildSystemUser reads cwd/fs). */
function executionContext(model: BaseChatModel, overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext & { cleanup: () => void } {
  const config: PipelineConfig = PipelineConfigSchema.parse({ label: "col", harness: "bare" });
  const runsRoot = mkdtempSync(join(tmpdir(), "lc-driver-"));
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
      registry: { listDefinitions: () => [] },
      names: new Set<string>(),
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

describe("LangChainDriver.run", () => {
  it("emits the banner, streamed answer, and a successful complete event", { timeout: 60_000 }, async () => {
    const driver = new LangChainDriver();
    const model = new ScriptedChatModel([new AIMessage("The answer is 4.")]);
    const context = executionContext(model);
    try {
      const events = await collect(driver.run(context));
      expect(events[0]?.type).toBe("token_update");
      expect(events.some((event) => event.type === "thought" && event.content.includes("LangChain"))).toBe(true);
      // The real createAgent loop runs the scripted model to completion: the run
      // must finish with a complete terminal and no error convergence.
      expect(events.some((event) => event.type === "error")).toBe(false);
      const terminal = events.at(-1);
      expect(terminal?.type).toBe("complete");
      expect(terminal?.passed).not.toBe(false);
    } finally {
      context.cleanup();
    }
  });

  it("converges model failure into an error event followed by an unsuccessful complete", { timeout: 60_000 }, async () => {
    const driver = new LangChainDriver();
    const exploding = {
      // Duck-typed vendor object: passes requireChatModel, fails inside createAgent streaming.
      invoke: async () => {
        throw new Error("model exploded with credentials");
      },
    };
    const context = executionContext(exploding as never);
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
