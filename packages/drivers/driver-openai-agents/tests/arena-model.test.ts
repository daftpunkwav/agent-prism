/**
 * @file arena-model tests
 * @description Locks the Agents SDK Model implementation over the Arena LLM port.
 *
 * Responsibilities:
 * - Pin the non-streaming and streaming protocol arcs the SDK consumes
 * - Pin tool-schema projection, thinking/usage plumbing and hook ordering
 */

import { describe, expect, it } from "vitest";
import type { LlmAdapter, LlmCallOptions, LlmMessage, LlmStreamPart } from "@agentprism/contracts";
import type { ModelRequest } from "@openai/agents";
import { ArenaModel, toOutputItems, toSdkUsage } from "../src/arena-model.js";

/** Model port stub recording each call's messages/options. */
class StubLlm implements LlmAdapter {
  calls: Array<{ messages: LlmMessage[]; options?: LlmCallOptions }> = [];

  constructor(private readonly parts: LlmStreamPart[]) {}

  async *stream(messages: LlmMessage[], options?: LlmCallOptions): AsyncIterable<LlmStreamPart> {
    this.calls.push({ messages, ...(options !== undefined ? { options } : {}) });
    for (const part of this.parts) yield part;
  }

  async invoke(messages: LlmMessage[], options?: LlmCallOptions) {
    this.calls.push({ messages, ...(options !== undefined ? { options } : {}) });
    return {
      text: this.parts.map((part) => part.text ?? "").join(""),
      toolCalls: this.parts.flatMap((part) => part.toolCalls ?? []),
      usage: this.parts.find((part) => part.usage !== undefined)?.usage,
    };
  }
}

/** Minimal ModelRequest: only the fields the Arena model reads. */
function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    input: "hi",
    modelSettings: {},
    tools: [],
    outputType: "text",
    handoffs: [],
    tracing: false,
    ...overrides,
  } as ModelRequest;
}

describe("ArenaModel.getResponse", () => {
  it("returns text, tool calls and usage in the SDK's shapes", async () => {
    const llm = new StubLlm([
      {
        text: "hello",
        toolCalls: [{ id: "c1", name: "read", args: { path: "a.txt" } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      },
    ]);
    const model = new ArenaModel(llm);
    const response = await model.getResponse(
      request({
        tools: [
          { type: "function", name: "read", description: "read", parameters: { type: "object" }, strict: false },
        ] as ModelRequest["tools"],
      }),
    );
    expect(response.usage.inputTokens).toBe(5);
    expect(response.output).toEqual([
      expect.objectContaining({ type: "message", role: "assistant" }),
      expect.objectContaining({ type: "function_call", name: "read", arguments: '{"path":"a.txt"}' }),
    ]);
    // Registry schemas ride to the model through the port's tool list.
    expect(llm.calls[0]?.options?.tools).toHaveLength(1);
    expect(llm.calls[0]?.options?.tools?.[0]).toMatchObject({
      name: "read",
      description: "read",
      jsonSchema: { type: "object" },
    });
  });
});

describe("ArenaModel.getStreamedResponse", () => {
  it("emits response_started, text deltas and a completed response", async () => {
    const llm = new StubLlm([
      { thinking: "hmm", text: "4" },
      { text: "." },
      { usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ]);
    const model = new ArenaModel(llm);
    const events: unknown[] = [];
    for await (const event of model.getStreamedResponse(request())) events.push(event);
    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      "response_started",
      "output_text_delta",
      "output_text_delta",
      "response_done",
    ]);
    const done = events.at(-1) as { response: { id: string; output: unknown[] } };
    expect(done.response.id).toBe("arena-1");
    expect(done.response.output).toHaveLength(2);
  });

  it("keeps the Arena provider defaults when request.modelSettings is set", async () => {
    const llm = new StubLlm([{ text: "x" }]);
    const model = new ArenaModel(llm);
    for await (const _event of model.getStreamedResponse(request({ modelSettings: { temperature: 0.9 } }))) {
      // drain
    }
    // Temperature/max tokens come from the configured column model; the Arena
    // model never re-applies SDK-side settings.
    expect(llm.calls[0]?.options?.responseFormat).toBeUndefined();
    expect(llm.calls[0]?.options?.tools).toBeUndefined();
  });
});

describe("ArenaModel hooks", () => {
  it("reports call boundaries, text, thinking and usage", async () => {
    const llm = new StubLlm([{ thinking: "t", text: "a", usage: { prompt_tokens: 3, completion_tokens: 1 } }]);
    const seen: string[] = [];
    const model = new ArenaModel(llm, () => undefined, {
      onRequestStart: () => seen.push("start"),
      onRequestEnd: () => seen.push("end"),
      onTextDelta: (text) => seen.push(`text:${text}`),
      onReasoning: (text) => seen.push(`think:${text}`),
      onUsage: (usage) => seen.push(`usage:${String(usage?.["prompt_tokens"])}`),
    });
    for await (const _event of model.getStreamedResponse(request())) {
      // drain
    }
    expect(seen).toEqual(["start", "think:t", "text:a", "end", "usage:3"]);
  });

  it("resolves registered definitions and falls back for SDK-built tools", async () => {
    const llm = new StubLlm([{ text: "x" }]);
    const registered = {
      name: "read",
      description: "registered",
      jsonSchema: { type: "object" },
      mutatesWorkspace: false,
      execute: async () => ({ result: "", fileDiff: null, ok: true as const }),
    };
    const model = new ArenaModel(llm, (name) => (name === "read" ? registered : undefined));
    for await (const _event of model.getStreamedResponse(
      request({
        tools: [
          { type: "function", name: "read", description: "x", parameters: { type: "object" }, strict: false },
          { type: "function", name: "transfer_to_x", description: "handoff", parameters: undefined, strict: false },
        ] as ModelRequest["tools"],
      }),
    )) {
      // drain
    }
    expect(llm.calls[0]?.options?.tools?.[0]).toBe(registered);
    // Handoff tools have no registry entry: they still bind, schema-only.
    expect(llm.calls[0]?.options?.tools?.[1]).toMatchObject({ name: "transfer_to_x", jsonSchema: { type: "object" } });
  });
});

describe("toOutputItems", () => {
  it("orders thinking, text and tool calls", () => {
    const items = toOutputItems("id-1", "text", "think", [{ id: "c1", name: "read", args: {} }]);
    expect(items.map((item) => (item as { type: string }).type)).toEqual(["reasoning", "message", "function_call"]);
  });

  it("omits empty text and thinking", () => {
    expect(toOutputItems("id-1", "", "", [])).toEqual([]);
  });
});

describe("toSdkUsage", () => {
  it("reads both OpenAI and Anthropic detail namings", () => {
    const openai = toSdkUsage({ prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 1 } });
    expect(openai.inputTokensDetails).toEqual([{ cached_tokens: 1 }]);
    const anthropic = toSdkUsage({
      input_tokens: 4,
      output_tokens: 2,
      input_tokens_details: { cached_tokens: 2 },
      output_tokens_details: { reasoning_tokens: 1 },
    });
    expect(anthropic.totalTokens).toBe(6);
    expect(anthropic.outputTokensDetails).toEqual([{ reasoning_tokens: 1 }]);
  });
});
