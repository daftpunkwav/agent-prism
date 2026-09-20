/**
 * @file chat-model-adapter test
 * @description Locks responseFormat mapping: OpenAI response_format, Anthropic forced tool.
 */
import { describe, expect, it, vi } from "vitest";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { FINAL_ANSWER_RESPONSE_FORMAT } from "@agentprism/contracts";
import { ChatModelLlmAdapter } from "@agentprism/provider-langchain";

const USER_MESSAGE = [{ role: "user" as const, content: "x" }];

describe("ChatModelLlmAdapter responseFormat", () => {
  it("maps the format to OpenAI json_schema response_format", async () => {
    const model = new ChatOpenAI({ apiKey: "test", model: "gpt-4o" });
    const invokeSpy = vi
      .spyOn(model, "invoke")
      .mockResolvedValue(new AIMessageChunk('{"plan":"p","files":[],"how_to_run":"r"}'));
    const adapter = new ChatModelLlmAdapter(model);

    await adapter.invoke(USER_MESSAGE, { responseFormat: FINAL_ANSWER_RESPONSE_FORMAT });

    const kwargs = invokeSpy.mock.calls[0]?.[1] as {
      response_format?: { type: string; json_schema?: { name: string; strict: boolean } };
    };
    expect(kwargs.response_format?.type).toBe("json_schema");
    expect(kwargs.response_format?.json_schema?.name).toBe("final_answer");
    expect(kwargs.response_format?.json_schema?.strict).toBe(true);
  });

  it("maps the format to an Anthropic forced schema tool and returns the args payload", async () => {
    const model = new ChatAnthropic({ apiKey: "test", model: "claude-3" });
    const args = { plan: "p", files: ["a.py"], how_to_run: "python a.py" };
    const bindSpy = vi.spyOn(model, "bindTools").mockReturnValue({
      invoke: async () =>
        new AIMessage({
          content: "",
          tool_calls: [{ id: "t1", name: "final_answer", args, type: "tool_call" }],
        }),
    } as never);
    const adapter = new ChatModelLlmAdapter(model);

    const result = await adapter.invoke(USER_MESSAGE, { responseFormat: FINAL_ANSWER_RESPONSE_FORMAT });

    const [defs, kwargs] = bindSpy.mock.calls[0] as [
      Array<{ name: string; input_schema?: unknown }>,
      { tool_choice?: { type: string; name: string } },
    ];
    expect(defs[0]?.name).toBe("final_answer");
    expect(defs[0]?.input_schema).toEqual(FINAL_ANSWER_RESPONSE_FORMAT.schema);
    expect(kwargs.tool_choice).toEqual({ type: "tool", name: "final_answer" });
    expect(result.text).toBe(JSON.stringify(args));
  });

  it("leaves plain invokes untouched when no format is requested", async () => {
    const model = new ChatOpenAI({ apiKey: "test", model: "gpt-4o" });
    const invokeSpy = vi.spyOn(model, "invoke").mockResolvedValue(new AIMessageChunk("plain"));
    const adapter = new ChatModelLlmAdapter(model);

    const result = await adapter.invoke(USER_MESSAGE);

    expect(invokeSpy.mock.calls[0]?.[1]).not.toHaveProperty("response_format");
    expect(result.text).toBe("plain");
  });
});
