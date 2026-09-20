/**
 * @file chat model adapter stream tests
 * @description Covers ChatModelLlmAdapter.stream: thinking/text splitting and tool-call tail.
 *
 * Responsibilities:
 * - Pin stream parts for thinking and visible text from chunk streams
 * - Lock the gathered tool-call tail emitted after the last chunk
 * - Pin the fail-loud error when tools are requested from a non-binding model
 */

import { describe, expect, it } from "vitest";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessageChunk } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { Runnable } from "@langchain/core/runnables";
import type { LlmMessage, LlmStreamPart, ToolDefinition } from "@agentprism/contracts";
import { ChatModelLlmAdapter } from "../src/chat-model-adapter.js";

/** Scripted model whose stream emits thinking + text + a tool-call chunk. */
class StreamingScriptedModel extends BaseChatModel {
  constructor() {
    super({});
  }

  override _llmType(): string {
    return "scripted";
  }

  override bindTools(): Runnable {
    return this;
  }

  override async _generate(_messages: BaseMessage[], _options?: Record<string, unknown>): Promise<ChatResult> {
    return {
      generations: [
        {
          text: "hello world",
          message: new AIMessageChunk({
            content: "hello world",
            tool_call_chunks: [
              { name: "read", args: JSON.stringify({ path: "a.txt" }), id: "c1", type: "tool_call_chunk", index: 0 },
            ],
          }),
        },
      ],
    };
  }

  override async *_streamResponseChunks(_messages: BaseMessage[]): AsyncGenerator<ChatGenerationChunk> {
    yield new ChatGenerationChunk({
      message: new AIMessageChunk({
        content: "",
        additional_kwargs: { reasoning_content: "pondering" },
      }),
      text: "",
    });
    yield new ChatGenerationChunk({ message: new AIMessageChunk({ content: "hello " }), text: "hello " });
    yield new ChatGenerationChunk({ message: new AIMessageChunk({ content: "world" }), text: "world" });
    yield new ChatGenerationChunk({
      message: new AIMessageChunk({
        content: "",
        tool_call_chunks: [{ name: "read", args: "{\"path\":\"a.txt\"}", id: "c1", type: "tool_call_chunk", index: 0 }],
      }),
      text: "",
    });
  }
}

/** Model that cannot bind tools (no bindTools method at all). */
class PlainModel extends BaseChatModel {
  constructor() {
    super({});
  }

  override _llmType(): string {
    return "plain";
  }

  override async _generate(_messages: BaseMessage[], _options?: Record<string, unknown>): Promise<ChatResult> {
    return { generations: [{ text: "", message: new AIMessageChunk({ content: "hi" }) }] };
  }
}

const messages: LlmMessage[] = [{ role: "user", content: "q" }];

async function collect(parts: AsyncIterable<LlmStreamPart>): Promise<LlmStreamPart[]> {
  const out: LlmStreamPart[] = [];
  for await (const part of parts) out.push(part);
  return out;
}

describe("ChatModelLlmAdapter.stream", () => {
  it("splits thinking from text and appends the gathered tool calls", async () => {
    const adapter = new ChatModelLlmAdapter(new StreamingScriptedModel());
    const parts = await collect(adapter.stream(messages));
    expect(parts).toEqual([
      { thinking: "pondering" },
      { text: "hello " },
      { text: "world" },
      { toolCalls: [{ id: "c1", name: "read", args: { path: "a.txt" } }] },
    ]);
  });

  it("invokes with tools through the model's bindTools path", async () => {
    const adapter = new ChatModelLlmAdapter(new StreamingScriptedModel());
    const tools = [{ name: "read", description: "read a file", jsonSchema: { type: "object" } }] as unknown as ToolDefinition[];
    const result = await adapter.invoke(messages, { tools });
    expect(result.toolCalls).toEqual([{ id: "c1", name: "read", args: { path: "a.txt" } }]);
    expect(result.text).toBe("hello world");
  });

  it("fails loud when tools are requested from a model without bindTools", async () => {
    const adapter = new ChatModelLlmAdapter(new PlainModel());
    const tools = [{ name: "read", description: "d", jsonSchema: { type: "object" } }] as unknown as ToolDefinition[];
    await expect(collect(adapter.stream(messages, { tools }))).rejects.toThrow(/does not support tool binding/);
  });
});
