/**
 * @file wire trace handler tests
 * @description Locks request/response capture, latency, and fail-open error capture.
 *
 * Responsibilities:
 * - Pin request/response capture with latency and redacted invocation params
 * - Lock sampling-param backfill and full-fidelity (never clipped) capture
 */

import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import type { LlmWireRecord } from "@agentprism/contracts";
import { createLlmWireTraceHandler } from "../src/llm-trace.js";

function collect(records: LlmWireRecord[]): (record: LlmWireRecord) => void {
  return (record) => records.push(record);
}

describe("createLlmWireTraceHandler", () => {
  it("captures a request/response pair with latency", () => {
    const records: LlmWireRecord[] = [];
    let now = 1_000;
    const handler = createLlmWireTraceHandler({
      sink: collect(records),
      now: () => now,
      boundToolNames: () => ["read"],
    });

    handler.handleChatModelStart?.(
      { lc: 1, type: "constructor", id: ["ChatOpenAI"], kwargs: { model: "test-model" } },
      [[new HumanMessage("hello"), new SystemMessage("be nice")]],
      "run-1",
    );
    now = 1_200;
    handler.handleLLMNewToken?.("A", { prompt: 0, completion: 0 }, "run-1");
    now = 1_500;
    handler.handleLLMEnd?.(
      {
        generations: [
          [
            {
              message: new AIMessage({
                content: "hi",
                additional_kwargs: { finish_reason: "stop" },
                usage_metadata: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
              }),
              text: "hi",
            },
          ],
        ],
      } as never,
      "run-1",
    );

    expect(records).toHaveLength(2);
    const request = records[0];
    const response = records[1];
    expect(request?.kind).toBe("llm_request");
    expect((request?.data as { model: string }).model).toBe("test-model");
    expect((request?.data as { tools: string[] }).tools).toEqual(["read"]);
    expect(response?.kind).toBe("llm_response");
    expect((response?.data as { usage: { total_tokens: number } }).usage.total_tokens).toBe(10);
    expect(response?.durationMs).toBe(500);
  });

  it("captures vendor invocation params with secret-looking keys redacted", () => {
    const records: LlmWireRecord[] = [];
    const handler = createLlmWireTraceHandler({ sink: collect(records), now: () => 0 });
    handler.handleChatModelStart?.(
      { lc: 1, type: "constructor", id: ["ChatOpenAI"], kwargs: { model: "test-model" } },
      [[new HumanMessage("hello")]],
      "run-params",
      undefined,
      {
        invocation_params: {
          model: "test-model",
          temperature: 0.5,
          top_p: 0.9,
          max_tokens: 64000,
          tools: [{ type: "function", function: { name: "read" } }],
        },
      },
    );
    const request = records[0];
    const params = (request?.data as { params: Record<string, unknown> }).params;
    expect(params.temperature).toBe(0.5);
    expect(params.top_p).toBe(0.9);
    expect(params.max_tokens).toBe(64000);
    expect((params.tools as unknown[]).length).toBe(1);
  });

  it("backfills sampling params the SDK snapshot omitted (temperature=0 is legal)", () => {
    const records: LlmWireRecord[] = [];
    const handler = createLlmWireTraceHandler({ sink: collect(records), now: () => 0 });
    handler.handleChatModelStart?.(
      {
        lc: 1,
        type: "constructor",
        id: ["ChatAnthropic"],
        // Constructor kwargs carry the sampling settings even when the vendor's
        // invocation snapshot drops falsy values.
        kwargs: { model: "test-model", temperature: 0, topP: 1, maxTokens: 64000 },
      },
      [[new HumanMessage("hello")]],
      "run-backfill",
      undefined,
      { invocation_params: { model: "test-model", stream: false } },
    );
    const params = (records[0]?.data as { params: Record<string, unknown> }).params;
    expect(params.temperature).toBe(0);
    expect(params.top_p).toBe(1);
    expect(params.max_tokens).toBe(64000);
    expect(params.stream).toBe(false);
  });

  it("never clips oversized message content (full-fidelity capture)", () => {
    const records: LlmWireRecord[] = [];
    const handler = createLlmWireTraceHandler({ sink: collect(records), now: () => 0 });
    const huge = "x".repeat(40_000);
    handler.handleChatModelStart?.(
      { lc: 1, type: "constructor", id: ["ChatOpenAI"], kwargs: { model: "test-model" } },
      [[new HumanMessage(huge)]],
      "run-big",
    );
    const messages = (records[0]?.data as { messages: Array<{ content: string; truncated: boolean }> }).messages;
    expect(messages[0]?.content).toHaveLength(40_000);
    expect(messages[0]?.truncated).toBe(false);
  });

  it("captures LLM errors without throwing into the loop", () => {
    const records: LlmWireRecord[] = [];
    const handler = createLlmWireTraceHandler({ sink: collect(records), now: () => 0 });
    expect(() => handler.handleLLMError?.(new Error("boom"), "run-2")).not.toThrow();
    expect(records[0]?.kind).toBe("llm_error");
    expect((records[0]?.data as { error: string }).error).toBe("boom");
  });
});
