/**
 * @file openai-responses-compat tests
 * @description Locks the Responses payload normalization: null annotations on
 * output_text parts coerce to empty arrays on every carrier shape (top-level
 * output, event.response.output, event.item), and the fetch wrapper patches
 * streaming SSE and JSON bodies of POST /responses while passing everything
 * else through untouched.
 */
import { describe, expect, it, vi } from "vitest";
import { createResponsesCompatFetch, patchResponsesEvent } from "../src/openai-responses-compat.js";

describe("patchResponsesEvent", () => {
  it("coerces null annotations to empty arrays on all carrier shapes", () => {
    const completed = {
      type: "response.completed",
      response: {
        output: [{ type: "message", content: [{ type: "output_text", text: "hi", annotations: null }] }],
      },
    };
    patchResponsesEvent(completed);
    const part = (completed as any).response.output[0].content[0];
    expect(part.annotations).toEqual([]);

    const itemDone = {
      type: "response.output_item.done",
      item: { type: "message", content: [{ type: "output_text", text: "hi", annotations: null }] },
    };
    patchResponsesEvent(itemDone);
    expect((itemDone as any).item.content[0].annotations).toEqual([]);

    const flat = { output: [{ type: "message", content: [{ type: "output_text", text: "x", annotations: null }] }] };
    patchResponsesEvent(flat);
    expect((flat as any).output[0].content[0].annotations).toEqual([]);
  });

  it("leaves non-null annotations, other part types, and foreign shapes untouched", () => {
    const event = {
      output: [
        { type: "message", content: [{ type: "output_text", text: "x", annotations: [{ text: "cite" }] }] },
        { type: "function_call", name: "run", arguments: "{}" },
      ],
    };
    patchResponsesEvent(event);
    expect((event.output[0] as any).content[0].annotations).toEqual([{ text: "cite" }]);
    expect(event.output[1]).toEqual({ type: "function_call", name: "run", arguments: "{}" });
    expect(patchResponsesEvent("raw")).toBe("raw");
    expect(patchResponsesEvent(null)).toBe(null);
    // Null/absent output and non-message items must not throw.
    expect(patchResponsesEvent({ response: { output: null } })).toBeDefined();
    expect(patchResponsesEvent({ item: { type: "message", content: null } })).toBeDefined();
  });
});

describe("createResponsesCompatFetch", () => {
  function sseResponse(lines: string[]): Response {
    return new Response(lines.join("\n") + "\n", { headers: { "content-type": "text/event-stream" } });
  }

  it("patches streaming SSE bodies of POST /responses", async () => {
    const inner = vi.fn().mockResolvedValue(
      sseResponse([
        ": ping",
        'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"hi","annotations":null}]}]}}',
        "data: [DONE]",
      ]),
    );
    const wrapped = createResponsesCompatFetch(inner as unknown as typeof fetch);
    const res = await wrapped("https://gw.example.com/v1/responses", { method: "POST" });
    const text = await res.text();
    expect(text).toContain('"annotations":[]');
    expect(text).toContain("[DONE]");
    expect(text).not.toContain('"annotations":null');
    expect(inner).toHaveBeenCalledOnce();
  });

  it("passes non-responses URLs and non-stream JSON of other routes through untouched", async () => {
    const inner = vi.fn().mockResolvedValue(new Response('{"annotations":null}', { headers: { "content-type": "application/json" } }));
    const wrapped = createResponsesCompatFetch(inner as unknown as typeof fetch);
    const res = await wrapped("https://gw.example.com/v1/chat/completions", { method: "POST" });
    expect(await res.text()).toBe('{"annotations":null}');
  });

  it("patches non-streaming JSON bodies of POST /responses (invoke path)", async () => {
    const inner = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "hi", annotations: null }] }] }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const wrapped = createResponsesCompatFetch(inner as unknown as typeof fetch);
    const res = await wrapped("https://gw.example.com/v1/responses", { method: "POST" });
    const body = (await res.json()) as { output: Array<{ content: Array<{ annotations: unknown }> }> };
    expect(body.output[0]?.content[0]?.annotations).toEqual([]);
  });
});
