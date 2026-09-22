/**
 * @file structured-finalize test
 * @description Locks schema normalization and fail-open behavior of the finalize step.
 */
import { describe, expect, it, vi } from "vitest";
import type { LlmAdapter, LlmInvokeResult } from "@agentprism/contracts";
import { finalizeStructuredAnswer } from "../src/structured-finalize.js";
import type { AgentExecutionContext } from "../src/execution-context.js";

/** Minimal context: the finalize only touches llm and signal. */
function contextWith(llm: LlmAdapter): AgentExecutionContext {
  return { llm, signal: undefined } as unknown as AgentExecutionContext;
}

function stubAdapter(response: string): { adapter: LlmAdapter; invoke: ReturnType<typeof vi.fn> } {
  const invoke = vi.fn(
    async (): Promise<LlmInvokeResult> => ({ text: response, toolCalls: [] }),
  );
  return { adapter: { invoke, stream: async function* () {} }, invoke };
}

describe("finalizeStructuredAnswer", () => {
  it("canonicalizes a valid JSON reply and sends the response format", async () => {
    const { adapter, invoke } = stubAdapter('{"plan":"p","files":["a.py"],"how_to_run":"bash"}');
    const result = await finalizeStructuredAnswer(contextWith(adapter), "raw answer");
    expect(result).toBe('{"plan":"p","files":["a.py"],"how_to_run":"bash"}');
    const options = invoke.mock.calls[0]?.[1] as { responseFormat?: { name: string }; signal?: unknown };
    expect(options.responseFormat?.name).toBe("final_answer");
  });

  it("extracts JSON from fenced prose replies", async () => {
    const { adapter } = stubAdapter('Here you go:\n```json\n{"plan":"p","files":[],"how_to_run":"r"}\n```');
    const result = await finalizeStructuredAnswer(contextWith(adapter), "raw");
    expect(result).toBe('{"plan":"p","files":[],"how_to_run":"r"}');
  });

  it("returns null when a required key is missing", async () => {
    const { adapter } = stubAdapter('{"plan":"p","files":[]}');
    expect(await finalizeStructuredAnswer(contextWith(adapter), "raw")).toBeNull();
  });

  it("returns null when the adapter rejects the constrained call", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("response_format is not supported");
    });
    const adapter: LlmAdapter = { invoke, stream: async function* () {} };
    expect(await finalizeStructuredAnswer(contextWith(adapter), "raw")).toBeNull();
  });

  it("short-circuits empty answers without calling the model", async () => {
    const { adapter, invoke } = stubAdapter("{}");
    expect(await finalizeStructuredAnswer(contextWith(adapter), "   ")).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
