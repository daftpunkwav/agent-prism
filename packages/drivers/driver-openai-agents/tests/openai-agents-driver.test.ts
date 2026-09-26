/**
 * @file openai agents driver tests
 * @description Runs OpenAIAgentsDriver end to end through the real SDK Runner.
 *
 * Responsibilities:
 * - Pin the happy path: banner → streamed answer → complete(success)
 * - Pin tool dispatch: the SDK executes registry tools through the shared guarded path
 * - Pin the error path: model failure converges into error + complete(success=false)
 *
 * The run loop is the real Agent/Runner; only the model is scripted, through the
 * Arena LlmAdapter the SDK Model is built on (no network, no SDK mocks).
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBuiltinToolRegistry } from "@agentprism/tool-builtins";
import type { ArenaEvent, LlmAdapter, LlmCallOptions, LlmMessage, LlmStreamPart, PipelineConfig } from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import type { AgentExecutionContext } from "@agentprism/harness";
import { WorkspaceRegistry } from "@agentprism/runtime";
import { TokenTracker } from "@agentprism/telemetry";
import { OpenAIAgentsDriver } from "../src/openai-agents-driver.js";
import { bindRegistryToolsForAgents, toToolParameters } from "../src/tool-bridge.js";
import { toSdkUsage } from "../src/arena-model.js";

/** Scripted model port: one response per call, then the last one repeats. */
class ScriptedLlm implements LlmAdapter {
  calls: LlmMessage[][] = [];
  private idx = 0;

  constructor(private readonly responses: LlmStreamPart[]) {}

  async *stream(messages: LlmMessage[]): AsyncIterable<LlmStreamPart> {
    this.calls.push(messages);
    const response = this.responses[Math.min(this.idx, this.responses.length - 1)]!;
    this.idx += 1;
    yield response;
  }

  async invoke(messages: LlmMessage[], _options?: LlmCallOptions) {
    const parts: LlmStreamPart[] = [];
    for await (const part of this.stream(messages)) parts.push(part);
    return {
      text: parts.map((part) => part.text ?? "").join(""),
      toolCalls: parts.flatMap((part) => part.toolCalls ?? []),
    };
  }
}

/** Real workspace under a throwaway runs root (buildSystemUser reads cwd/fs). */
function executionContext(
  llm: LlmAdapter,
  overrides: Partial<AgentExecutionContext> = {},
): AgentExecutionContext & { cleanup: () => void } {
  const registry = createBuiltinToolRegistry();
  const config: PipelineConfig = PipelineConfigSchema.parse({ label: "col", harness: "bare" });
  const runsRoot = mkdtempSync(join(tmpdir(), "openai-agents-driver-"));
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
    llm,
    llmVendor: null,
    tools: {
      registry,
      names: new Set(registry.listDefinitions().map((definition) => definition.name)),
      execute: async (name: string) =>
        name === "todo_write"
          ? { result: "todos updated", fileDiff: null, ok: true }
          : { result: "ok", fileDiff: null, ok: true },
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

describe("OpenAIAgentsDriver", () => {
  it("declares the framework id and display name the registry and banner map use", () => {
    const driver = new OpenAIAgentsDriver();
    expect(driver.frameworkId).toBe("openai_agents");
    expect(driver.displayName).toBe("OpenAI Agents SDK");
  });

  it("emits the banner, streamed answer, and a successful complete event", { timeout: 60_000 }, async () => {
    const driver = new OpenAIAgentsDriver();
    const llm = new ScriptedLlm([{ text: "The answer is 4." }]);
    const context = executionContext(llm);
    try {
      const events = await collect(driver.run(context));
      expect(events[0]?.type).toBe("token_update");
      const banner = events.find((event) => event.type === "thought" && event.content.includes("OpenAI Agents SDK"));
      expect(banner).toBeDefined();
      expect(banner?.content).toContain("prompt=");
      expect(banner?.content).toContain("reasoning=");
      const streamed = events
        .filter((event) => event.type === "thought_delta")
        .map((event) => (event as ArenaEvent & { content: string }).content)
        .join("");
      expect(streamed).toContain("The answer is 4.");
      expect(events.some((event) => event.type === "error")).toBe(false);
      const terminal = events.at(-1);
      expect(terminal?.type).toBe("complete");
      expect((terminal as ArenaEvent & { metrics: { success: boolean } }).metrics.success).toBe(true);
      // The system prompt travels as agent instructions, the user turn as input.
      expect(llm.calls[0]?.[0]?.role).toBe("system");
      expect(llm.calls[0]?.[0]?.content).toContain("Available tools:");
      const firstUser = llm.calls[0]?.findLast((message) => message.role === "user");
      expect(firstUser?.content).toContain("What is 2+2?");
    } finally {
      context.cleanup();
    }
  });

  it("lets the SDK dispatch a registry tool through the shared guarded path", { timeout: 60_000 }, async () => {
    const driver = new OpenAIAgentsDriver();
    const llm = new ScriptedLlm([
      { toolCalls: [{ id: "call_1", name: "todo_write", args: { todos: [{ content: "step", done: false }] } }] },
      { text: "Done." },
    ]);
    let executed = 0;
    const context = executionContext(llm, {
      tools: {
        registry: createBuiltinToolRegistry(),
        names: new Set(["todo_write"]),
        execute: async (name: string) => {
          executed += 1;
          return { result: `${name} ran`, fileDiff: null, ok: true };
        },
      },
    });
    try {
      const events = await collect(driver.run(context));
      expect(executed).toBe(1);
      const action = events.find((event) => event.type === "action");
      expect(action).toBeDefined();
      expect((action as ArenaEvent & { tool: string }).tool).toBe("todo_write");
      const observation = events.find((event) => event.type === "observation");
      expect((observation as ArenaEvent & { result: string }).result).toContain("todo_write ran");
      expect(events.some((event) => event.type === "error")).toBe(false);
      expect((events.at(-1) as ArenaEvent & { metrics: { success: boolean } }).metrics.success).toBe(true);
      // The follow-up model call must carry the tool result back to the model.
      expect(JSON.stringify(llm.calls[1])).toContain("todo_write ran");
    } finally {
      context.cleanup();
    }
  });

  it("converges model failure into an error event followed by an unsuccessful complete", { timeout: 60_000 }, async () => {
    const driver = new OpenAIAgentsDriver();
    const exploding: LlmAdapter = {
      stream: async function* () {
        throw new Error("model exploded with credentials");
      },
      invoke: async () => {
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

describe("bindRegistryToolsForAgents", () => {
  it("binds one function tool per registry definition", () => {
    const registry = createBuiltinToolRegistry();
    const bound = bindRegistryToolsForAgents(
      {
        registry,
        names: new Set(registry.listDefinitions().map((definition) => definition.name)),
        execute: async () => ({ result: "ok", fileDiff: null, ok: true }),
      },
      { question: "q", harness: "bare" },
    );
    expect(bound.map((tool) => tool.name)).toEqual(registry.listDefinitions().map((definition) => definition.name));
    expect(bound[0]?.type).toBe("function");
  });
});

describe("toToolParameters", () => {
  it("projects the registry schema into the SDK's non-strict object shape", () => {
    const parameters = toToolParameters({
      type: "object",
      properties: { path: { type: "string" }, limit: { type: "integer" } },
      required: ["path"],
    });
    expect(parameters).toEqual({
      type: "object",
      properties: { path: { type: "string" }, limit: { type: "integer" } },
      required: ["path"],
      additionalProperties: true,
    });
  });

  it("declares no required fields when the schema omits them", () => {
    expect(toToolParameters({ type: "object", properties: { a: { type: "string" } } }).required).toEqual([]);
  });
});

describe("toSdkUsage", () => {
  it("reports the token totals and detail arrays the SDK expects", () => {
    const usage = toSdkUsage({
      prompt_tokens: 10,
      completion_tokens: 4,
      prompt_tokens_details: { cached_tokens: 3 },
      completion_tokens_details: { reasoning_tokens: 2 },
    });
    expect(usage.inputTokens).toBe(10);
    expect(usage.outputTokens).toBe(4);
    expect(usage.totalTokens).toBe(14);
    expect(usage.inputTokensDetails).toEqual([{ cached_tokens: 3 }]);
    expect(usage.outputTokensDetails).toEqual([{ reasoning_tokens: 2 }]);
  });

  it("reports empty details when the provider gives none", () => {
    const usage = toSdkUsage(undefined);
    expect(usage.inputTokens).toBe(0);
    expect(usage.inputTokensDetails).toEqual([{}]);
  });
});
