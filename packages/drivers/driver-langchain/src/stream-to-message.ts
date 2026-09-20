/**
 * @file stream-to-message
 * @description Concatenates a LangChain token stream into a final AIMessage.
 *
 * Responsibilities:
 * - Consume chat runnable token streams, including tool_calls
 *
 * Used by LangGraph nodes so graph.streamEvents still sees on_chat_model_stream.
 */

import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import type { Runnable, RunnableConfig } from "@langchain/core/runnables";

function toChunk(value: unknown): AIMessageChunk {
  if (value instanceof AIMessageChunk) return value;
  if (value instanceof AIMessage) {
    return new AIMessageChunk({
      content: value.content,
      tool_call_chunks: [],
      additional_kwargs: value.additional_kwargs,
      response_metadata: value.response_metadata,
      id: value.id,
    });
  }
  return new AIMessageChunk({ content: "" });
}

/**
 * Streams a bound chat model and returns the concatenated AIMessage.
 * Does not fall back to invoke: a stream yielding zero chunks is a real driver
 * failure (fail-closed; callers converge it into an error event). Returning an
 * empty message instead would report success with no model output.
 */
export async function streamToAiMessage(
  runnable: Runnable,
  input: unknown,
  config?: RunnableConfig,
): Promise<AIMessage> {
  let acc: AIMessageChunk | undefined;
  const stream = await runnable.stream(input, config);
  for await (const raw of stream) {
    const chunk = toChunk(raw);
    acc = acc === undefined ? chunk : acc.concat(chunk);
  }
  if (acc === undefined) {
    throw new Error("Model stream produced no chunks");
  }
  return new AIMessage({
    content: acc.content,
    additional_kwargs: acc.additional_kwargs,
    response_metadata: acc.response_metadata,
    tool_calls: acc.tool_calls,
    invalid_tool_calls: acc.invalid_tool_calls,
    usage_metadata: acc.usage_metadata,
    id: acc.id,
  });
}
