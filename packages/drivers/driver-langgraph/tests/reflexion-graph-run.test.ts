/**
 * @file reflexion graph run tests
 * @description Executes the reflexion reasoning graph end to end on a scripted chat model.
 *
 * Responsibilities:
 * - Pin the draft → reflect → END flow when the critique finds no retry keyword
 * - Pin the draft → reflect → retry → END flow when the critique demands improvement
 * - Pin tool-call routing through the tools node mid-draft
 *
 * The graph machinery is the real @langchain/langgraph StateGraph; the model is
 * a scripted BaseChatModel (no network, no SDK mocks).
 */

import { describe, expect, it } from "vitest";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { Runnable } from "@langchain/core/runnables";
import type { ToolExecutionResult } from "@agentprism/contracts";
import type { ToolAccess } from "@agentprism/harness";
import { buildReflexionGraph } from "../src/graphs/reflexion.js";
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

describe("buildReflexionGraph execution", () => {
  it("ends after one critique when the reflection holds no retry keyword", async () => {
    const model = new ScriptedChatModel([
      new AIMessage("The answer is 4."),
      // Reflection: satisfied, no retry keywords.
      new AIMessage("The answer is accurate and complete."),
    ]);
    const graph = buildReflexionGraph(deps(model, toolAccess())).compile();
    const final = await graph.invoke({ messages: [new HumanMessage("q")], max_steps: 5 });
    expect(final.reflections).toHaveLength(1);
    expect(final.reflections[0]).toContain("accurate and complete");
    const last = final.messages.at(-1) as AIMessage;
    expect(last.content).toContain("accurate and complete");
    expect(final.step_count).toBe(1);
  });

  it("re-executes when the reflection demands improvement, then ends", async () => {
    const model = new ScriptedChatModel([
      new AIMessage("Draft answer."),
      // Reflection contains the "improve" retry keyword → one more execute.
      new AIMessage("This could improve: show the work."),
      new AIMessage("Better answer with work shown."),
      new AIMessage("Now the answer is accurate and complete."),
    ]);
    const graph = buildReflexionGraph(deps(model, toolAccess())).compile();
    const final = await graph.invoke({ messages: [new HumanMessage("q")], max_steps: 5 });
    expect(final.reflections).toHaveLength(2);
    const last = final.messages.at(-1) as AIMessage;
    expect(last.content).toContain("accurate and complete");
    expect(final.step_count).toBe(2);
  });

  it("routes tool calls through the tools node before reflecting", async () => {
    const tool = toolAccess({ grep: () => ok("matched") });
    const model = new ScriptedChatModel([
      new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "grep", args: { pattern: "x" }, type: "tool_call" }] }),
      new AIMessage("answer using the grep hit"),
      new AIMessage("The answer is complete."),
    ]);
    const graph = buildReflexionGraph(deps(model, tool)).compile();
    const final = await graph.invoke({ messages: [new HumanMessage("q")], max_steps: 5 });
    expect(tool.executed).toEqual(["grep"]);
    expect(final.reflections).toHaveLength(1);
  });

  it("ends instead of routing to tools once the step budget is exhausted", async () => {
    const tool = toolAccess({ grep: () => ok("never reached") });
    const model = new ScriptedChatModel([
      new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "grep", args: {}, type: "tool_call" }] }),
      new AIMessage("The answer is complete."),
    ]);
    const graph = buildReflexionGraph(deps(model, tool)).compile();
    // max_steps=1: the execute node consumed the budget, so a tool-call draft
    // must route to reflect (outside the budget) instead of the tools node.
    const final = await graph.invoke({ messages: [new HumanMessage("q")], max_steps: 1 });
    expect(tool.executed).toEqual([]);
    expect(final.reflections).toHaveLength(1);
  });
});
