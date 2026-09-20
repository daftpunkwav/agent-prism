/**
 * @file verification loop tests
 * @description Covers the verification loop wrapping driver attempts.
 *
 * Responsibilities:
 * - Lock bare passthrough and verify-retry with suppressed intermediate completes
 * - Lock the retry cap overrides in both directions
 * - Lock reflect and self-evolve retries: feedback threading and harness edits
 */

import { describe, expect, it, vi } from "vitest";
import type { ArenaEvent } from "@agentprism/contracts";
import { runVerificationLoop } from "../../src/verification/loop.js";

function thought(content: string): ArenaEvent {
  return {
    type: "thought",
    pipeline: "col",
    workspace: "ws",
    content,
    tool: "",
    args: {},
    result: "",
    step: 1,
    passed: null,
    reason: "",
    metrics: null,
    message: "",
    token_stats: null,
    turn: 1,
    runId: "r",
    timestamp: 0,
  };
}

function complete(): ArenaEvent {
  return {
    type: "complete",
    pipeline: "col",
    workspace: "ws",
    content: "",
    tool: "",
    args: {},
    result: "",
    step: 0,
    passed: null,
    reason: "",
    metrics: {
      success: true,
      duration_ms: 1,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      tool_calls: 0,
      steps: 1,
      context_window: 1,
      max_input_tokens: 1,
      max_output_tokens: 1,
      context_usage_pct: 0,
      input_usage_pct: 0,
    },
    message: "",
    token_stats: null,
    turn: 1,
    runId: "r",
    timestamp: 0,
  };
}

describe("runVerificationLoop", () => {
  it("passes through bare attempts unchanged", async () => {
    const events: ArenaEvent[] = [];
    for await (const event of runVerificationLoop(
      {
        level: "bare",
        question: "q",
        llm: { invoke: vi.fn(), stream: vi.fn() },
        feedback: { text: "" },
        pipelineLabel: "col",
        workspaceName: "ws",
      },
      async function* () {
        yield thought("answer");
        yield complete();
      },
    )) {
      events.push(event);
    }
    expect(events.map((e) => e.type)).toEqual(["thought", "complete"]);
  });

  it("retries verify once and suppresses the intermediate complete", async () => {
    let attempts = 0;
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ text: '{"passed": false, "reason": "incomplete"}', toolCalls: [] })
      .mockResolvedValueOnce({ text: '{"passed": true, "reason": "ok"}', toolCalls: [] });

    const events: ArenaEvent[] = [];
    for await (const event of runVerificationLoop(
      {
        level: "verify",
        question: "q",
        llm: { invoke, stream: vi.fn() },
        feedback: { text: "" },
        pipelineLabel: "col",
        workspaceName: "ws",
      },
      async function* () {
        attempts += 1;
        yield thought(attempts === 1 ? "bad" : "good final answer");
        yield complete();
      },
    )) {
      events.push(event);
    }

    expect(attempts).toBe(2);
    expect(events.filter((e) => e.type === "complete")).toHaveLength(1);
    expect(events.filter((e) => e.type === "verify")).toHaveLength(2);
    expect(events.some((e) => e.type === "verify" && e.passed === true)).toBe(true);
  });

  it("honors a retry cap override below the built-in default", async () => {
    let attempts = 0;
    // Every judge call fails: the loop would retry to the default cap (2) without the override.
    const invoke = vi.fn().mockResolvedValue({ text: '{"passed": false, "reason": "no"}', toolCalls: [] });

    for await (const _event of runVerificationLoop(
      {
        level: "verify",
        question: "q",
        llm: { invoke, stream: vi.fn() },
        feedback: { text: "" },
        pipelineLabel: "col",
        workspaceName: "ws",
        maxRetries: { verify: 1 },
      },
      async function* () {
        attempts += 1;
        yield thought("answer");
        yield complete();
      },
    )) {
      // Drain.
    }
    expect(attempts).toBe(1);
  });

  it("honors a retry cap override above the built-in default", async () => {
    let attempts = 0;
    const invoke = vi.fn().mockImplementation(async () => {
      // Pass on the third attempt.
      return attempts >= 3
        ? { text: '{"passed": true, "reason": "ok"}', toolCalls: [] }
        : { text: '{"passed": false, "reason": "no"}', toolCalls: [] };
    });

    for await (const _event of runVerificationLoop(
      {
        level: "verify",
        question: "q",
        llm: { invoke, stream: vi.fn() },
        feedback: { text: "" },
        pipelineLabel: "col",
        workspaceName: "ws",
        maxRetries: { verify: 3 },
      },
      async function* () {
        attempts += 1;
        yield thought("answer");
        yield complete();
      },
    )) {
      // Drain.
    }
    expect(attempts).toBe(3);
  });

  it("reflects between attempts and threads the insight as feedback", async () => {
    let attempts = 0;
    // Dispatch by each step's distinctive prompt marker: the judge asks for a
    // {"passed": ...} verdict, the reflector for an {"insight": ...}.
    const invoke = vi.fn().mockImplementation(async (messages) => {
      const text = JSON.stringify(messages.at(-1)?.content ?? "");
      if (text.includes("insight")) return { text: '{"insight": "Focus on the failing step", "strategy": "retry"}', toolCalls: [] };
      if (text.includes("true/false")) return { text: '{"passed": false, "reason": "wrong direction"}', toolCalls: [] };
      return { text: '{"passed": true, "reason": "ok"}', toolCalls: [] };
    });
    const feedback = { text: "" };

    for await (const _event of runVerificationLoop(
      {
        level: "reflect",
        question: "q",
        llm: { invoke, stream: vi.fn() },
        feedback,
        pipelineLabel: "col",
        workspaceName: "ws",
        maxRetries: { reflect: 3 },
      },
      async function* () {
        attempts += 1;
        yield thought("answer");
        yield complete();
      },
    )) {
      // Drain.
    }
    expect(attempts).toBe(3);
    // The reflector's strategy rode into the next attempt's feedback bag
    // (reflectOnFailure returns strategy before insight).
    expect(feedback.text).toBe("retry");
  });

  it("threads a self-evolve prompt addition into the feedback on retry", async () => {
    let attempts = 0;
    // Dispatch by each step's prompt marker: judge ("passed"), reflector
    // ("insight"), evolver ("prompt_additions").
    const llmInvoke = vi.fn().mockImplementation(async (messages) => {
      const text = JSON.stringify(messages.at(-1)?.content ?? "");
      if (text.includes("prompt_additions")) return { text: '{"prompt_additions": ["extra rule"], "reasoning": "r"}', toolCalls: [] };
      if (text.includes("insight")) return { text: '{"insight": "look closer", "strategy": "s"}', toolCalls: [] };
      if (text.includes("true/false")) return { text: '{"passed": false, "reason": "no"}', toolCalls: [] };
      return { text: '{"passed": true, "reason": "ok"}', toolCalls: [] };
    });
    const feedback = { text: "" };

    for await (const event of runVerificationLoop(
      {
        level: "self_evolve",
        question: "q",
        llm: { invoke: llmInvoke, stream: vi.fn() },
        feedback,
        pipelineLabel: "col",
        workspaceName: "ws",
        maxRetries: { self_evolve: 2 },
      },
      async function* () {
        attempts += 1;
        yield thought("answer");
        yield complete();
      },
    )) {
      expect(["verify", "reflect", "harness_edit", "thought", "complete"]).toContain(event.type);
    }
    expect(attempts).toBe(2);
    // Evolve additions land in the feedback threaded into attempt 2.
    expect(feedback.text).toContain("extra rule");
    expect(feedback.text).toContain("Harness self-evolve");
  });
});
