/**
 * @file stream-to-message tests
 * @description Locks stream-to-AIMessage concatenation and fail-closed behavior.
 *
 * Responsibilities:
 * - Pin that a zero-chunk stream throws instead of yielding an empty success
 * - Pin chunk concatenation, AIMessage coercion, and empty-chunk tolerance
 */

import { describe, expect, it } from "vitest";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { streamToAiMessage } from "../src/stream-to-message.js";

/** Fake runnable whose stream() yields the scripted values verbatim. */
function scriptedStream(values: unknown[]): { stream: () => Promise<AsyncIterable<unknown>> } {
  return {
    async stream() {
      return (async function* () {
        for (const value of values) yield value;
      })();
    },
  };
}

describe("streamToAiMessage", () => {
  it("throws on an empty stream (fail-closed; callers converge into error events)", async () => {
    const runnable = {
      async *stream() {
        // yields nothing
      },
    };
    await expect(streamToAiMessage(runnable as never, {})).rejects.toThrow("no chunks");
  });

  it("concatenates successive chunks into one AIMessage", async () => {
    const message = await streamToAiMessage(
      scriptedStream([
        new AIMessageChunk({ content: "hel" }),
        new AIMessageChunk({ content: "lo" }),
      ]) as never,
      {},
    );
    expect(message).toBeInstanceOf(AIMessage);
    expect(message.content).toBe("hello");
  });

  it("coerces plain AIMessage stream items into chunks (content kept, tool calls not reconstructed)", async () => {
    const message = await streamToAiMessage(
      scriptedStream([
        new AIMessage({
          content: "using tool",
          tool_calls: [{ id: "c1", name: "read", args: { path: "a.txt" }, type: "tool_call" }],
        }),
      ]) as never,
      {},
    );
    // Chunk coercion passes tool_call_chunks: [] on purpose: only real chunk
    // streams (AIMessageChunk concat) carry tool calls through to the result.
    expect(message.content).toBe("using tool");
    expect(message.tool_calls).toEqual([]);
  });

  it("tolerates unrecognizable stream items as empty chunks instead of crashing", async () => {
    const message = await streamToAiMessage(scriptedStream(["garbage"]) as never, {});
    expect(message.content).toBe("");
  });
});
