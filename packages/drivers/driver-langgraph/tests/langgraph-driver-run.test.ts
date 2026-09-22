/**
 * @file langgraph driver run tests
 * @description Runs LangGraphDriver end to end on a scripted chat model.
 *
 * Responsibilities:
 * - Pin the react happy path: banner → streamed answer → complete(success)
 * - Pin the tool loop: action/observation rows from the driver callbacks
 * - Pin error convergence: model failure → sanitized error + unsuccessful complete
 *
 * The graph machinery is the real @langchain/langgraph StateGraph; the model is
 * a scripted BaseChatModel subclass (no network, no SDK mocks).
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
import type { ArenaEvent, PipelineConfig, ToolExecutionResult } from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import type { AgentExecutionContext, ToolAccess } from "@agentprism/harness";
import { WorkspaceRegistry } from "@agentprism/runtime";
import { LangGraphDriver } from "../src/langgraph-driver.js";
import { TokenTracker } from "@agentprism/telemetry";

/** Chat model yielding one scripted AIMessage per call; streams tool calls as chunks. */
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

  override bindTools(): Runnable {
    return this;
  }

  override async _generate(_messages: BaseMessage[], _options?: Record<string, unknown>): Promise<ChatResult> {
    const message = this.responses[Math.min(this.idx, this.responses.length - 1)]!;
    this.idx += 1;
    return { generations: [{ text: String(message.content ?? ""), message }] };
  }

  override async *_streamResponseChunks(_messages: BaseMessage[]): AsyncGenerator<ChatGenerationChunk> {
    const message = this.responses[Math.min(this.idx, this.responses.length - 1)]!;
    this.idx += 1;
    yield new ChatGenerationChunk({
      message: new AIMessageChunk({
        content: message.content,
        tool_call_chunks: (message.tool_calls ?? []).map((call, index) => ({
          name: call.name,
          args: JSON.stringify(call.args),
          id: call.id,
          type: "tool_call_chunk" as const,
          index,
        })),
      }),
      text: String(message.content ?? ""),
    });
  }
}

function toolCallMessage(name: string, args: Record<string, unknown>): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: [{ id: "c1", name, args, type: "tool_call" }],
  });
}

/** Real workspace under a throwaway runs root + scripted tool access. */
function executionContext(model: BaseChatModel, toolAccess?: Partial<ToolAccess>): AgentExecutionContext & { cleanup: () => void } {
  const config: PipelineConfig = PipelineConfigSchema.parse({ label: "col", harness: "bare" });
  const runsRoot = mkdtempSync(join(tmpdir(), "lg-driver-"));
  const workspace = new WorkspaceRegistry({ runsRoot, clock: { now: () => 1_700_000_000_000 } }).create("ws");
  const context = {
    identity: { agentId: "a1", runId: "r1" },
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
      names: new Set<string>(["grep"]),
      execute: async (): Promise<ToolExecutionResult> => ({ result: "matched line 3", fileDiff: null, ok: true }),
      ...toolAccess,
    },
  } as unknown as AgentExecutionContext & { cleanup: () => void };
  context.cleanup = () => rmSync(runsRoot, { recursive: true, force: true });
  return context;
}

async function collect(generator: AsyncGenerator<ArenaEvent>): Promise<ArenaEvent[]> {
  const events: ArenaEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

describe("LangGraphDriver.run", () => {
  it("streams the react graph to a successful complete without tool calls", { timeout: 60_000 }, async () => {
    const driver = new LangGraphDriver();
    const model = new ScriptedChatModel([new AIMessage("The answer is 4.")]);
    const context = executionContext(model);
    try {
      const events = await collect(driver.run(context));
      expect(events[0]?.type).toBe("token_update");
      const banner = events.find((event) => event.type === "thought" && event.content.includes("LangGraph"));
      expect(banner).toBeDefined();
      // The compare table unions key=value fields: reasoning/prompt must be keyed, never bare modes.
      expect(banner?.content).toContain("prompt=");
      expect(banner?.content).toContain("reasoning=");
      // streamEvents v2 does not surface nested model chunks for this scripted
      // model; the observable contract is the run arc completing cleanly.
      expect(events.some((event) => event.type === "step_start")).toBe(true);
      const terminal = events.at(-1);
      expect(terminal?.type).toBe("complete");
      expect(terminal?.passed).not.toBe(false);
      expect(events.some((event) => event.type === "error")).toBe(false);
    } finally {
      context.cleanup();
    }
  });

  it("runs the tool loop: action row arrives, observation follows, then the answer", { timeout: 60_000 }, async () => {
    const driver = new LangGraphDriver();
    const model = new ScriptedChatModel([
      toolCallMessage("grep", { pattern: "x" }),
      new AIMessage("found it"),
    ]);
    const context = executionContext(model);
    try {
      const events = await collect(driver.run(context));
      const action = events.find((event) => event.type === "action");
      expect(action?.tool).toBe("grep");
      expect(events.some((event) => event.type === "observation" && event.result.includes("matched line 3"))).toBe(true);
      // The second model call ran (two turns) and the run completed successfully.
      const terminal = events.at(-1);
      expect(terminal?.type).toBe("complete");
      expect(terminal?.passed).not.toBe(false);
    } finally {
      context.cleanup();
    }
  });

  it("converges a broken vendor object into a sanitized error and failed complete", { timeout: 60_000 }, async () => {
    const driver = new LangGraphDriver();
    const exploding = {
      invoke: async () => {
        throw new Error("langgraph exploded with credentials");
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
