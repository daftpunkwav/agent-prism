/**
 * @file react graph run tests
 * @description Executes the ReAct reasoning graph end to end on a scripted chat model.
 *
 * Responsibilities:
 * - Pin the no-tool straight-to-END path and the tool-call loop path
 * - Lock tool-node edge behavior: unknown tools, tool runtime errors, and
 *   step-budget exhaustion
 *
 * The graph machinery is the real @langchain/langgraph StateGraph; the model is
 * a scripted BaseChatModel (no network, no SDK mocks).
 */

import { describe, expect, it } from "vitest";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, AIMessageChunk, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { Runnable } from "@langchain/core/runnables";
import type { ToolExecutionResult } from "@agentprism/contracts";
import type { ToolAccess } from "@agentprism/harness";
import { buildReactGraph } from "../src/graphs/react.js";
import type { ReasoningGraphDeps } from "../src/graphs/state.js";

/** Chat model answering each call with the next scripted message (loops on the last). */
class ScriptedChatModel extends BaseChatModel {
  private responses: AIMessage[];
  private idx = 0;

  constructor(responses: AIMessage[]) {
    super({});
    this.responses = responses;
  }

  override _llmType(): string {
    return "scripted";
  }

  override bindTools(): Runnable {
    return this;
  }

  override async _generate(_messages: BaseMessage[], _options?: Record<string, unknown>): Promise<ChatResult> {
    const message = this.responses[Math.min(this.idx, this.responses.length - 1)]!;
    this.idx += 1;
    return { generations: [{ text: String(message.content ?? ""), message }] };
  }

  override async *_streamResponseChunks(_messages: BaseMessage[]): AsyncGenerator<ChatGenerationChunk> {
    const message = this.responses[Math.min(this.idx, this.responses.length - 1)]!;
    this.idx += 1;
    // Tool calls must travel as tool_call_chunks: AIMessageChunk concat rebuilds
    // structured tool_calls from them (mirrors how real providers stream).
    yield new ChatGenerationChunk({
      message: new AIMessageChunk({
        content: message.content,
        tool_call_chunks: (message.tool_calls ?? []).map((call, index) => ({
          name: call.name,
          args: JSON.stringify(call.args),
          id: call.id,
          type: "tool_call_chunk" as const,
          index,
        })),
      }),
      text: String(message.content ?? ""),
    });
  }
}

function toolCallMessage(name: string, args: Record<string, unknown>): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: [{ id: "c1", name, args, type: "tool_call" }],
  });
}

/** Tool double: records executions and scripts outcomes per name. */
function toolAccess(script: Record<string, () => ToolExecutionResult> = {}): ToolAccess & { executed: string[] } {
  const executed: string[] = [];
  return {
    registry: { listDefinitions: () => [] },
    names: new Set(Object.keys(script)),
    executed,
    execute: async (name: string) => {
      executed.push(name);
      const producer = script[name];
      if (!producer) throw new Error(`tool ${name} not scripted`);
      return producer();
    },
  } as unknown as ToolAccess & { executed: string[] };
}

function deps(model: BaseChatModel, tools: ToolAccess): ReasoningGraphDeps {
  return { model, tools, lcTools: [] };
}

const ok = (result: string): ToolExecutionResult => ({ result, fileDiff: null, ok: true });

describe("buildReactGraph execution", () => {
  it("finishes straight away when the model answers without tool calls", async () => {
    const model = new ScriptedChatModel([new AIMessage("42 is the answer.")]);
    const graph = buildReactGraph(deps(model, toolAccess())).compile();
    const final = await graph.invoke({ messages: [new HumanMessage("q")], max_steps: 5 });
    const last = final.messages.at(-1) as AIMessage;
    expect(last.content).toBe("42 is the answer.");
    expect(final.step_count).toBe(1);
  });

  it("loops through the tools node and returns the final answer after the observation", async () => {
    const tool = toolAccess({ grep: () => ok("matched: line 3") });
    const model = new ScriptedChatModel([
      toolCallMessage("grep", { pattern: "x" }),
      new AIMessage("found it"),
    ]);
    const graph = buildReactGraph(deps(model, tool)).compile();
    const final = await graph.invoke({ messages: [new HumanMessage("q")], max_steps: 5 });
    expect(tool.executed).toEqual(["grep"]); // the tool ran exactly once through tools.execute
    const toolResult = final.messages.find((message) => message instanceof ToolMessage) as ToolMessage;
    expect(String(toolResult.content)).toContain("matched: line 3");
    const last = final.messages.at(-1) as AIMessage;
    expect(last.content).toBe("found it");
    expect(final.tool_calls).toBe(1);
  });

  it("answers with an error ToolMessage for unknown tools instead of crashing", async () => {
    const tool = toolAccess(); // no tools authorized
    const model = new ScriptedChatModel([
      toolCallMessage("rogue_tool", {}),
      new AIMessage("done anyway"),
    ]);
    const graph = buildReactGraph(deps(model, tool)).compile();
    const final = await graph.invoke({ messages: [new HumanMessage("q")], max_steps: 5 });
    const toolResult = final.messages.find((message) => message instanceof ToolMessage) as ToolMessage;
    expect(String(toolResult.content)).toContain("rogue_tool");
    expect(String(toolResult.content)).toContain("unknown tool");
  });

  it("converts tool runtime exceptions into error text and keeps the loop alive", async () => {
    const tool = toolAccess({
      explode: () => {
        throw new Error("disk on fire");
      },
    });
    const model = new ScriptedChatModel([
      toolCallMessage("explode", {}),
      new AIMessage("recovered"),
    ]);
    const graph = buildReactGraph(deps(model, tool)).compile();
    const final = await graph.invoke({ messages: [new HumanMessage("q")], max_steps: 5 });
    const toolResult = final.messages.find((message) => message instanceof ToolMessage) as ToolMessage;
    // Tool exceptions degrade to a sanitized error line; detail text is scrubbed.
    expect(String(toolResult.content)).toContain("tool explode failed");
    const last = final.messages.at(-1) as AIMessage;
    expect(last.content).toBe("recovered");
  });

  it("stops at the step budget without executing further tool calls", async () => {
    const tool = toolAccess({ grep: () => ok("never reached") });
    const model = new ScriptedChatModel([toolCallMessage("grep", {})]);
    const graph = buildReactGraph(deps(model, tool)).compile();
    // max_steps=1 and the first agent node already consumed the budget: the router
    // must END before the tools node runs.
    const final = await graph.invoke({ messages: [new HumanMessage("q")], max_steps: 1 });
    const toolMessages = final.messages.filter((message) => message instanceof ToolMessage);
    expect(toolMessages).toHaveLength(0);
  });
});
