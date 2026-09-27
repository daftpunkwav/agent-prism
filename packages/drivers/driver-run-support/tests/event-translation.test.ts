/**
 * @file event translation tests
 * @description Locks neutral event construction: defaults and tool-outcome emission.
 */

import { describe, expect, it } from "vitest";
import type { TokenTracker } from "@agentprism/telemetry";
import {
  canonicalToolName,
  createRunState,
  emitStreamEvent,
  emitToolOutcomeEvents,
  eventOf,
  finishEvent,
  modelOutputText,
  normalizeActionArgs,
} from "../src/event-translation.js";

describe("eventOf", () => {
  it("fills neutral defaults around the partial", () => {
    const event = eventOf({ type: "action", pipeline: "col", tool: "read" });
    expect(event.type).toBe("action");
    expect(event.pipeline).toBe("col");
    expect(event.tool).toBe("read");
    expect(event.workspace).toBe("");
    expect(event.step).toBe(0);
  });
});

describe("emitToolOutcomeEvents", () => {
  it("emits nothing for plain results without diffs", () => {
    expect(emitToolOutcomeEvents("col", "ws", 1, "read", { result: "ok", fileDiff: null })).toEqual([]);
  });

  it("emits file_diff for edits", () => {
    const events = emitToolOutcomeEvents("col", "ws", 2, "edit", { result: "ok", fileDiff: "Edited a.txt" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "file_diff", pipeline: "col", step: 2, content: "Edited a.txt" });
  });

  it("streams run output as 400-char progress chunks", () => {
    const events = emitToolOutcomeEvents("col", "ws", 1, "bash", { result: "x".repeat(900), fileDiff: null });
    expect(events).toHaveLength(3);
    expect(events.every((event) => event.type === "tool_progress")).toBe(true);
    expect(events.map((event) => event.content).join("")).toBe("x".repeat(900));
  });
});

describe("on_tool_end output serialization", () => {
  function state() {
    return createRunState("col", { addUsage: () => {} } as unknown as TokenTracker, { now: () => 0 });
  }

  it("renders ToolMessage block content instead of [object Object]", () => {
    const events = emitStreamEvent(state(), {
      event: "on_tool_end",
      data: { output: { content: [{ type: "text", text: "hello" }] } },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "observation", result: "hello" });
  });

  it("falls back to JSON for opaque objects", () => {
    const events = emitStreamEvent(state(), {
      event: "on_tool_end",
      data: { output: { foo: "bar" } },
    });
    expect(events[0]?.result).toBe(JSON.stringify({ foo: "bar" }));
  });
});

describe("model-call arc (start → stream → end)", () => {
  function state() {
    const stats = {
      input_tokens: 3,
      output_tokens: 5,
      total_tokens: 8,
      context_window: 128_000,
      max_input_tokens: 120_000,
      max_output_tokens: 4_096,
      context_usage_pct: 0,
      input_usage_pct: 0,
    };
    const run = createRunState(
      "col",
      { addUsage: () => {}, asDict: () => stats, seedPrompt: () => {} } as unknown as TokenTracker,
      { now: () => 1_000 },
    );
    run.workspaceName = "ws";
    return run;
  }

  it("announces the step before the first token and attaches deltas to it", () => {
    const run = state();
    const start = emitStreamEvent(run, { event: "on_chat_model_start", data: {} });
    expect(start.map((e) => e.type)).toEqual(["step_start"]);
    expect(start[0]?.step).toBe(1);

    const stream = emitStreamEvent(run, {
      event: "on_chat_model_stream",
      data: { chunk: { content: "hel" } },
    });
    expect(stream.map((e) => e.type)).toEqual(["thought_delta"]);
    expect(stream[0]).toMatchObject({ content: "hel", step: 1 });
  });

  it("routes thinking chunks separately from visible text (a chunk carries either one)", () => {
    const run = state();
    emitStreamEvent(run, { event: "on_chat_model_start", data: {} });
    const thinking = emitStreamEvent(run, {
      event: "on_chat_model_stream",
      data: {
        chunk: { content: "answer", additional_kwargs: { reasoning_content: "hmm" } },
      },
    });
    expect(thinking.map((e) => e.type)).toEqual(["thinking"]);
    const text = emitStreamEvent(run, {
      event: "on_chat_model_stream",
      data: { chunk: { content: "answer" } },
    });
    expect(text.map((e) => e.type)).toEqual(["thought_delta"]);
  });

  it("closes the streaming thought on model end and counts the turn", () => {
    const run = state();
    emitStreamEvent(run, { event: "on_chat_model_start", data: {} });
    emitStreamEvent(run, { event: "on_chat_model_stream", data: { chunk: { content: "x" } } });
    const end = emitStreamEvent(run, { event: "on_chat_model_end", data: {} });
    expect(end.map((e) => e.type)).toEqual(["thought_end"]);
    expect(run.turns).toBe(1);
    expect(run.streamingStep).toBeNull();
  });

  it("emits action rows on tool start and observations on tool end", () => {
    const run = state();
    const start = emitStreamEvent(run, {
      event: "on_tool_start",
      data: { name: "read", input: { path: "a.txt" } },
      name: "read",
    });
    expect(start.map((e) => e.type)).toEqual(["action"]);
    expect(start[0]).toMatchObject({ tool: "read", args: { path: "a.txt" } });

    const end = emitStreamEvent(run, { event: "on_tool_end", data: { output: "plain" } });
    expect(end.map((e) => e.type)).toEqual(["observation"]);
    expect(end[0]?.result).toBe("plain");
    expect(run.toolCalls).toBe(1);
  });

  it("emits phase narration for non-excluded graph nodes and nothing for nested runnables", () => {
    const run = state();
    const excluded = new Set(["agent"]);
    // A node start is an on_chain_start whose langgraph_node metadata names the
    // node itself (the shape astream_events v2 really emits).
    expect(
      emitStreamEvent(run, { event: "on_chain_start", name: "agent", metadata: { langgraph_node: "agent" } }, { nodeStartExcluded: excluded }),
    ).toEqual([]);
    // Nested runnables inside a node carry the enclosing node's name but their own
    // `name`, so they are not node starts.
    expect(
      emitStreamEvent(
        run,
        { event: "on_chain_start", name: "RunnableLambda", metadata: { langgraph_node: "agent" } },
        { nodeStartExcluded: excluded },
      ),
    ).toEqual([]);
    const phases = emitStreamEvent(
      run,
      { event: "on_chain_start", name: "planner", metadata: { langgraph_node: "planner" } },
      { nodeStartExcluded: excluded },
    );
    // Narration rides reflect: the thought channel is the answer channel, and
    // answer extraction folds a thought event into the following deltas.
    expect(phases.map((e) => e.type)).toEqual(["reflect"]);
    expect(phases[0]?.content).toBe("[Phase: planner]");
  });

  it("keeps phase hints off unless the caller opts in", () => {
    // LangChain and Deep Agents run on LangGraph too: without the opt-in set their
    // node starts must not add phase thoughts to the answer channel.
    const run = state();
    expect(
      emitStreamEvent(run, { event: "on_chain_start", name: "planner", metadata: { langgraph_node: "planner" } }),
    ).toEqual([]);
  });

  it("ignores unrecognized raw event kinds", () => {
    expect(emitStreamEvent(state(), { event: "on_retriever_start", data: {} })).toEqual([]);
  });

  it("reads a completed model call's whole output text", () => {
    // The closing-thought fallback needs the output of on_chat_model_end only;
    // every other event (and a content-block list) must resolve to text or "".
    expect(
      modelOutputText({ event: "on_chat_model_end", data: { output: { content: "the answer" } } }),
    ).toBe("the answer");
    expect(
      modelOutputText({
        event: "on_chat_model_end",
        data: { output: { content: [{ type: "text", text: "block one" }, { type: "text", text: " block two" }] } },
      }),
    ).toBe("block one block two");
    expect(modelOutputText({ event: "on_chat_model_start", data: { output: { content: "x" } } })).toBe("");
    expect(modelOutputText(null)).toBe("");
    expect(modelOutputText("plain")).toBe("");
  });

  it("finishes with a complete event carrying observed workload metrics", () => {
    const run = state();
    emitStreamEvent(run, { event: "on_chat_model_start", data: {} });
    emitStreamEvent(run, { event: "on_chat_model_end", data: {} });
    emitStreamEvent(run, { event: "on_tool_start", data: { name: "read" }, name: "read" });
    const terminal = finishEvent(run, true);
    expect(terminal.type).toBe("complete");
    expect(terminal.metrics?.success).toBe(true);
    expect(terminal.metrics?.steps).toBe(1); // one model call = one turn
    expect(terminal.metrics?.tool_calls).toBe(1);
    expect(terminal.workspace).toBe("ws");
  });
});

describe("ask_user case tolerance (Arena stuck-run fix)", () => {
  it("resolves model-cased tool names to the canonical registry entry", () => {
    const names = new Set(["ask_user", "read"]);
    expect(canonicalToolName(names, "ASK_USER")).toBe("ask_user");
    expect(canonicalToolName(names, "Ask_User")).toBe("ask_user");
    expect(canonicalToolName(names, "read")).toBe("read");
    expect(canonicalToolName(names, "unknown_tool")).toBe("unknown_tool");
  });

  it("normalizes uppercased ask_user batch keys before emission", () => {
    const args = normalizeActionArgs("ask_user", {
      QUESTIONS: [{ ID: "TEST-1", HEADER: "工具测试", QUESTION: "这是一个测试问题?", OPTIONS: ["A"] }],
    });
    expect(args).toEqual({
      questions: [{ id: "TEST-1", header: "工具测试", question: "这是一个测试问题?", options: ["A"] }],
    });
  });

  it("leaves non-ask_user tools untouched", () => {
    const args = { PATH: "a.txt" };
    expect(normalizeActionArgs("read", args)).toBe(args);
  });

  it("unwraps an input-wrapped batch for display", () => {
    const inner = JSON.stringify({ questions: [{ id: "t", question: "Q?", options: [["A"]] }] });
    expect(normalizeActionArgs("ask_user", { input: inner })).toEqual({
      questions: [{ id: "t", question: "Q?", options: ["A"] }],
    });
  });
});
