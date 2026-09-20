/**
 * @file tot graph run tests
 * @description Executes the tree-of-thought reasoning graph on a scripted chat model.
 *
 * Responsibilities:
 * - Pin the branch→score→select→act chain over a configured width
 * - Pin argmax selection (ties break to the earliest branch) via the select note
 * - Pin the act→tools loop and the step budget consumed by branching
 *
 * The graph machinery is the real @langchain/langgraph StateGraph; the model is
 * a scripted BaseChatModel (no network, no SDK mocks).
 */

import { describe, expect, it } from "vitest";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, AIMessageChunk, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { Runnable } from "@langchain/core/runnables";
import type { ToolExecutionResult } from "@agentprism/contracts";
import type { ToolAccess } from "@agentprism/harness";
import { buildTotGraph, selectBestCandidate } from "../src/graphs/tot.js";
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

describe("selectBestCandidate", () => {
  it("picks the argmax and breaks ties toward the earliest branch", () => {
    expect(selectBestCandidate([{ plan: "a", score: 3 }, { plan: "b", score: 7 }, { plan: "c", score: 7 }])).toBe(1);
    expect(selectBestCandidate([{ plan: "a", score: 9 }, { plan: "b", score: 1 }])).toBe(0);
    expect(selectBestCandidate([])).toBe(0);
  });
});

describe("buildTotGraph execution", () => {
  it("branches, scores, selects the winner, and acts on it", async () => {
    // Per width-2 branch: one generate call + one score call, then act.
    const model = new ScriptedChatModel([
      new AIMessage("Plan A: brute force"),
      new AIMessage("SCORE: 4"),
      new AIMessage("Plan B: divide and conquer"),
      new AIMessage("SCORE: 8"),
      // act: no tool calls → END.
      new AIMessage("Executing plan B."),
    ]);
    const graph = buildTotGraph(deps(model, toolAccess()), 2).compile();
    const final = await graph.invoke({ messages: [new HumanMessage("q")], max_steps: 10 });
    // Width 2 = four branch/score calls, plus the act call.
    expect(final.step_count).toBe(5);
    const notes = final.messages.filter((message) => message instanceof SystemMessage);
    const select = notes.map((message) => String(message.content)).find((text) => text.includes("[ToT select]"));
    expect(select).toContain("branch 2/2");
    expect(select).toContain("score 8");
    expect(select).toContain("Plan B");
    const last = final.messages.at(-1) as AIMessage;
    expect(last.content).toBe("Executing plan B.");
  });

  it("loops through tools when the acting step issues tool calls", async () => {
    const tool = toolAccess({ grep: () => ok("hit") });
    const model = new ScriptedChatModel([
      new AIMessage("Plan A"),
      new AIMessage("SCORE: 5"),
      new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "grep", args: {}, type: "tool_call" }] }),
      new AIMessage("done with the hit"),
    ]);
    const graph = buildTotGraph(deps(model, tool), 1).compile();
    const final = await graph.invoke({ messages: [new HumanMessage("q")], max_steps: 10 });
    expect(tool.executed).toEqual(["grep"]);
    const last = final.messages.at(-1) as AIMessage;
    expect(last.content).toBe("done with the hit");
  });

  it("stops cleanly when branching exhausts the step budget", async () => {
    const model = new ScriptedChatModel([new AIMessage("Plan A"), new AIMessage("SCORE: 5")]);
    const graph = buildTotGraph(deps(model, toolAccess()), 3).compile();
    // The branch/score chain is fixed at build time (not budget-gated); only
    // the act routing checks max_steps. Width 3 = six calls plus the act call.
    const final = await graph.invoke({ messages: [new HumanMessage("q")], max_steps: 2 });
    expect(final.step_count).toBe(7);
  });
});
