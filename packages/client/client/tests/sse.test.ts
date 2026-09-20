/**
 * @file sse tests
 * @description Covers the shared SSE body pump.
 *
 * Responsibilities:
 * - Lock block assembly, tail-block parsing, comment skipping, and abort silence
 */

import { describe, expect, it } from "vitest";
import { pumpSSEBlocks } from "../src/sse.js";

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

async function collect(res: Response, signal?: AbortSignal): Promise<string[]> {
  const blocks: string[] = [];
  await pumpSSEBlocks(res, (data) => blocks.push(data), signal);
  return blocks;
}

describe("pumpSSEBlocks", () => {
  it("assembles data lines per blank-line-delimited block and skips comments", () => {
    return collect(
      sseResponse([': ping\n\ndata: {"a":1}\n\ndata: {"b"', ': 2}\n\n']),
    ).then((blocks) => {
      // Multi-line data payloads join with \n; the split chunk still assembles.
      expect(blocks).toEqual(['{"a":1}', '{"b": 2}']);
    });
  });

  it("parses a trailing block closed by connection end instead of a blank line", () => {
    return collect(sseResponse(['data: {"a":1}\n\ndata: {"b":2}'])).then((blocks) => {
      expect(blocks).toEqual(['{"a":1}', '{"b":2}']);
    });
  });

  it("ends silently on user abort instead of throwing", () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"a":1}\n\n'));
        // Real abort path: the fetch layer errors the body stream on abort. Deferred so the
        // queued block is read first (error() discards unread queued chunks per spec).
        queueMicrotask(() => {
          controller.abort();
          c.error(new DOMException("This operation was aborted", "AbortError"));
        });
      },
    });
    return expect(collect(new Response(stream), controller.signal)).resolves.toEqual(['{"a":1}']);
  });
});
