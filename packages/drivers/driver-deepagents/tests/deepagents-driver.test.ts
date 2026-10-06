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
import { AIMessage, AIMessageChunk, ToolMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { Runnable } from "@langchain/core/runnables";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { ArenaEvent, PipelineConfig } from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import type { AgentExecutionContext } from "@agentprism/harness";
import { WorkspaceRegistry } from "@agentprism/runtime";
import { TokenTracker } from "@agentprism/telemetry";
import { createBuiltinToolRegistry } from "@agentprism/tool-builtins";
import { FilesystemBackend, createDeepAgent, createFilesystemMiddleware } from "deepagents";
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

/** One scripted model turn: either a tool call or a final text answer. */
type ScriptedTurn = { toolCall?: { id: string; name: string; args: Record<string, unknown> }; text?: string };

/**
 * Scripted model for multi-turn agent (and subagent) runs: each turn streams
 * either a tool_call chunk or text — the deepagents agent consumes the
 * streaming path, so tool calls must ride tool_call_chunks to survive
 * aggregation. Turns past the last scripted step repeat it. Every
 * invocation's message list is recorded.
 */
class ScriptedTurnsChatModel extends BaseChatModel {
  readonly seen: BaseMessage[][] = [];
  private turn = 0;

  constructor(private readonly steps: ScriptedTurn[]) {
    super({});
  }

  override _llmType(): string {
    return "scripted-turns";
  }

  /** The deep-agent middleware binds tools; identity binding suffices for a script. */
  override bindTools(): Runnable {
    return this;
  }

  private current(): ScriptedTurn {
    return this.steps[Math.min(this.turn, this.steps.length - 1)]!;
  }

  private messageFor(step: ScriptedTurn): AIMessage {
    return step.toolCall
      ? new AIMessage({ content: "", tool_calls: [{ ...step.toolCall, type: "tool_call" }] })
      : new AIMessage(step.text ?? "");
  }

  override async _generate(messages: BaseMessage[], _options?: Record<string, unknown>): Promise<ChatResult> {
    this.seen.push([...messages]);
    const step = this.current();
    this.turn += 1;
    const message = this.messageFor(step);
    return { generations: [{ text: String(message.content ?? ""), message }] };
  }

  override async *_streamResponseChunks(messages: BaseMessage[]): AsyncGenerator<ChatGenerationChunk> {
    this.seen.push([...messages]);
    const step = this.current();
    this.turn += 1;
    if (step.toolCall) {
      yield new ChatGenerationChunk({
        message: new AIMessageChunk({
          content: "",
          tool_call_chunks: [
            {
              id: step.toolCall.id,
              name: step.toolCall.name,
              args: JSON.stringify(step.toolCall.args),
              index: 0,
              type: "tool_call_chunk",
            },
          ],
        }),
        text: "",
      });
      return;
    }
    const text = step.text ?? "";
    yield new ChatGenerationChunk({ message: new AIMessageChunk({ content: text }), text });
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

  it("rejects a stack-exhausting model-supplied glob pattern before the matcher runs", { timeout: 60_000 }, async () => {
    const driver = new DeepAgentsDriver();
    // Short but 40 levels deep: trips the depth bound specifically while
    // staying far under the length bound, so no pattern that could actually
    // exhaust a stack is needed to pin the guard.
    const deep = "{a,".repeat(40) + "b" + "}".repeat(40);
    const model = new ScriptedTurnsChatModel([
      { toolCall: { id: "call_1", name: "glob", args: { pattern: deep } } },
      { text: "The glob found nothing usable; done." },
    ]);
    const context = executionContext(model);
    try {
      const events = await collect(driver.run(context));
      expect(events.some((event) => event.type === "error")).toBe(false);
      const rejection = model.seen
        .flat()
        .filter((message): message is ToolMessage => message instanceof ToolMessage)
        .find((message) => String(message.content).includes("[pattern guard]"));
      expect(rejection).toBeDefined();
      expect(String(rejection?.content)).toContain('glob arg "pattern"');
      expect(String(rejection?.content)).toContain("nests braces 40 deep");
      const terminal = events.at(-1);
      expect(terminal?.type).toBe("complete");
      expect((terminal as ArenaEvent & { metrics: { success: boolean } }).metrics.success).toBe(true);
    } finally {
      context.cleanup();
    }
  });

  it("applies the pattern guard to delegated subagent glob calls too", { timeout: 60_000 }, async () => {
    const driver = new DeepAgentsDriver();
    const deep = "{a,".repeat(40) + "b" + "}".repeat(40);
    const model = new ScriptedTurnsChatModel([
      // Root turn: delegate to the framework's default general-purpose subagent.
      {
        toolCall: {
          id: "call_root",
          name: "task",
          args: { description: "Search the workspace for anything matching the pattern.", subagent_type: "general-purpose" },
        },
      },
      // Subagent turn: the delegated over-complex glob call.
      { toolCall: { id: "call_sub", name: "glob", args: { pattern: deep } } },
      // Subagent final turn, then the root final turn.
      { text: "Nothing to report." },
      { text: "Delegated search done." },
    ]);
    const context = executionContext(model);
    try {
      const events = await collect(driver.run(context));
      expect(events.some((event) => event.type === "error")).toBe(false);
      // The rejection must reach the SUBAGENT's model (third invocation), proving
      // the guard holds inside delegated runs where root middleware never lands.
      const subagentMessages = model.seen[2] ?? [];
      const rejection = subagentMessages
        .filter((message): message is ToolMessage => message instanceof ToolMessage)
        .find((message) => String(message.content).includes("[pattern guard]"));
      expect(rejection).toBeDefined();
      expect(String(rejection?.content)).toContain('glob arg "pattern"');
      expect(String(rejection?.content)).toContain("nests braces 40 deep");
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
      // biome-ignore lint/correctness/useYield: the stream faults before emitting any event
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

  it("raises AbortError instead of reporting a cancelled run as a success", { timeout: 60_000 }, async () => {
    const driver = new DeepAgentsDriver();
    const model = new ScriptedChatModel([new AIMessage("never delivered")]);
    // A cancelled graph stream ends normally once the in-flight node returns, so
    // the driver must not read that as an answered column.
    const context = executionContext(model, { signal: AbortSignal.abort() });
    try {
      const events: ArenaEvent[] = [];
      let thrown: unknown = null;
      try {
        for await (const event of driver.run(context)) events.push(event);
      } catch (error) {
        thrown = error;
      }
      expect((thrown as Error)?.name).toBe("AbortError");
      expect(events.some((event) => event.type === "complete")).toBe(false);
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

  it("reserves no name the framework would accept, and mounts a set the middleware accepts", () => {
    // The framework is the oracle for over-inclusion: every dropped name must
    // really trip its collision check — dropping a name it accepts would
    // silently remove a registry tool from this column. Under-inclusion (a
    // reserved name missing from the list) aborts a run at construction, which
    // is why the list is re-checked on every `deepagents` bump.
    const model = new ScriptedChatModel([new AIMessage("unused")]);
    // The collision check reads the tool's name only; the probe never runs.
    const probe = (name: string): StructuredToolInterface => ({ name, description: "probe" }) as StructuredToolInterface;
    for (const reserved of DEEPAGENTS_RESERVED_TOOL_NAMES) {
      expect(() => createDeepAgent({ model, tools: [probe(reserved)] })).toThrowError(/conflict with built-in tools/);
    }
    // The mounted read-only filesystem set is exactly what the middleware takes.
    expect(() =>
      createDeepAgent({
        model,
        middleware: [
          createFilesystemMiddleware({
            backend: new FilesystemBackend({ rootDir: tmpdir(), virtualMode: true }),
            tools: [...READ_ONLY_FILESYSTEM_TOOLS],
          }),
        ],
      }),
    ).not.toThrow();
  });
});
