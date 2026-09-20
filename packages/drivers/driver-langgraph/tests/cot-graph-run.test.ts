/**
 * @file cot graph run tests
 * @description Executes the chain-of-thought + tools graph end to end on a scripted chat model.
 *
 * Responsibilities:
 * - Pin the think → act → tools loop membership and the straight-to-END no-tool path
 * - Pin that the step budget ends the graph before the tools node runs
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
import { buildCotToolGraph } from "../src/graphs/cot-tool.js";
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

describe("buildCotToolGraph", () => {
  it("assembles the think / act / tools loop", () => {
    const compiled = buildCotToolGraph({} as never).compile();
    const nodeNames = Object.keys(compiled.getGraph().nodes);
    for (const name of ["think", "act", "tools"]) {
      expect(nodeNames).toContain(name);
    }
  });

  it("runs think then act and ends when no tool calls appear", async () => {
    const model = new ScriptedChatModel([new AIMessage("reasoning only"), new AIMessage("42")]);
    const graph = buildCotToolGraph(deps(model, toolAccess())).compile();
    const final = await graph.invoke({ messages: [new HumanMessage("q")], max_steps: 5 });
    const last = final.messages.at(-1) as AIMessage;
    expect(last.content).toBe("42");
    expect(final.step_count).toBe(2);
  });

  it("routes tool calls through the tools node and loops back to think", async () => {
    const tool = toolAccess({ grep: () => ok("matched: line 3") });
    const model = new ScriptedChatModel([
      new AIMessage("analyze first"),
      toolCallMessage("grep", { pattern: "x" }),
      new AIMessage("done"),
    ]);
    const graph = buildCotToolGraph(deps(model, tool)).compile();
    const final = await graph.invoke({ messages: [new HumanMessage("q")], max_steps: 10 });
    expect(tool.executed).toEqual(["grep"]);
    const toolResult = final.messages.find((message) => message instanceof ToolMessage) as ToolMessage;
    expect(String(toolResult.content)).toContain("matched: line 3");
    const last = final.messages.at(-1) as AIMessage;
    expect(last.content).toBe("done");
  });

  it("ends at the step budget before the tools node executes", async () => {
    const tool = toolAccess({ grep: () => ok("never reached") });
    const model = new ScriptedChatModel([toolCallMessage("grep", {})]);
    const graph = buildCotToolGraph(deps(model, tool)).compile();
    // think + act already consume max_steps=2: the router must END before tools runs.
    const final = await graph.invoke({ messages: [new HumanMessage("q")], max_steps: 2 });
    expect(tool.executed).toEqual([]);
    const toolMessages = final.messages.filter((message) => message instanceof ToolMessage);
    expect(toolMessages).toHaveLength(0);
  });
});
