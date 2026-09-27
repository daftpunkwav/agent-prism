/**
 * @file custom dimension hooks tests
 * @description Locks the four hook seams: budget folding, message shaping with
 * per-dimension observation, prompt/memory shaping, and prompt tags.
 */

import { describe, expect, it } from "vitest";
import type { CustomDimension, LlmMessage, MemoryRecallResult } from "@agentprism/contracts";
import { createContextAnalytics } from "../../src/context/analytics.js";
import { applyContextPipeline } from "../../src/context/pipeline.js";
import {
  applyCustomContextTuning,
  applyCustomMemory,
  applyCustomMessages,
  applyCustomPrompt,
  customPromptHint,
} from "../../src/dimensions/custom-dimension-hooks.js";
import { registerCustomDimensions, resolveCustomDimensions } from "../../src/dimensions/custom-dimensions.js";
import { summarizeAnalytics } from "../../src/context/analytics.js";

const transcript: LlmMessage[] = [
  { role: "system", content: "system" },
  { role: "user", content: "task" },
  { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read", args: {} }] },
  { role: "tool", content: "file body", toolCallId: "c1", name: "read" },
];

const probe: CustomDimension = {
  id: "hook_probe",
  label: "Hook probe",
  options: [
    { value: "small", label: "Small" },
    { value: "big", label: "Big" },
  ],
  promptHint: "\n[Probe: {value}]",
  hooks: {
    contextTuning: (value, base) => ({ summaryMaxChars: value === "big" ? 8000 : (base.summaryMaxChars ?? 4000) / 2 }),
    messages: (input, value) => {
      if (value !== "big") return input.messages;
      return input.messages.map((message) =>
        message.role === "tool" ? { ...message, content: "[masked]" } : message,
      );
    },
    prompt: (_input, value) => ({ system: `system+${value}` }),
    memory: (_input, value) => ({ limits: value === "big" ? { episodic: 10, semantic: 10 } : { episodic: 1, semantic: 1 } }),
  },
};

/** Dimension whose memory hook mutates its input instead of returning a patch (authoring mistake the seam contains). */
const mutatingProbe: CustomDimension = {
  id: "hook_mutator",
  label: "Mutator probe",
  options: [{ value: "on", label: "On" }],
  hooks: {
    memory: (input) => {
      input.limits.episodic = 99;
      return undefined;
    },
  },
};

registerCustomDimensions([probe, mutatingProbe]);
const active = () => resolveCustomDimensions({ hook_probe: "big" });
const run = { question: "q", custom: { hook_probe: "big" } };

describe("contextTuning hook", () => {
  it("folds the hook over the base budgets without mutating the shared bag", () => {
    const base = { windowSize: 12, summaryMaxChars: 4000 };
    const tuned = applyCustomContextTuning(active(), base, run);
    expect(tuned.summaryMaxChars).toBe(8000);
    expect(tuned.windowSize).toBe(12);
    expect(base.summaryMaxChars).toBe(4000);
  });

  it("returns the base object untouched when no dimension contributes", () => {
    const base = { windowSize: 12 };
    expect(applyCustomContextTuning([], base, run)).toBe(base);
  });
});

describe("messages hook", () => {
  it("shapes the transcript and reports the dimension's own effect", () => {
    const analytics = createContextAnalytics();
    const shaped = applyCustomMessages(active(), transcript, run, (id, before, after) =>
      analytics.effectiveness.observe({
        strategy: id,
        inputMessages: before.length,
        outputMessages: after.length,
        inputChars: before.reduce((sum, m) => sum + m.content.length, 0),
        outputChars: after.reduce((sum, m) => sum + m.content.length, 0),
        toolResultsDropped: 0,
        ledgerEmitted: false,
      }),
    );
    expect(shaped.find((message) => message.role === "tool")?.content).toBe("[masked]");
    expect(summarizeAnalytics(analytics).effectiveness).toContain("hook_probe");
  });

  it("runs through the pipeline after the strategy and before the pair-safety tail", () => {
    const dropped: CustomDimension = {
      id: "hook_probe_drop",
      label: "Drop probe",
      options: [{ value: "on", label: "On" }],
      hooks: { messages: (input) => input.messages.filter((message) => message.role !== "tool") },
    };
    registerCustomDimensions([dropped]);
    const out = applyContextPipeline(transcript, "sliding", {
      customDimensions: resolveCustomDimensions({ hook_probe_drop: "on" }),
      customRun: run,
    });
    // The unanswerable tool call is repaired by the shared tail, not left orphaned.
    expect(out.some((message) => message.role === "tool")).toBe(false);
    expect(
      out.some((message) => message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0),
    ).toBe(false);
  });
});

describe("prompt and memory hooks", () => {
  it("lets the prompt hook reshape the composed halves", () => {
    expect(applyCustomPrompt(active(), { system: "s", user: "u" }, run)).toEqual({ system: "system+big", user: "u" });
    expect(applyCustomPrompt([], { system: "s", user: "u" }, run)).toEqual({ system: "s", user: "u" });
  });

  it("moves recall and render caps together", () => {
    const recall: MemoryRecallResult = {
      episodic: Array.from({ length: 12 }, (_, i) => ({
        id: `e${i}`,
        task: `task ${i}`,
        framework: "native",
        model: "test-model",
        success: true,
        keyActions: [],
        lessons: "",
        timestamp: 0,
        workspaceTag: "",
      })),
      semantic: [],
    };
    const shaped = applyCustomMemory(active(), recall, { episodic: 3, semantic: 5 }, run);
    // "big" raises both the render cap and (for the top-N shape) the recall itself.
    expect(shaped.limits).toEqual({ episodic: 10, semantic: 10 });
    expect(shaped.recall).toBe(recall);
  });

  it("renders prompt tags with the selected value substituted", () => {
    expect(customPromptHint(active())).toBe("\n[Probe: big]");
    expect(customPromptHint([])).toBe("");
  });

  it("keeps a hook that mutates its caps local to the run", () => {
    // The seam hands the hook a copy: MEMORY_BLOCK_LIMITS is the process-wide
    // default every other column reads, so an in-place write must not repin it.
    const shared = { episodic: 3, semantic: 5 };
    const shaped = applyCustomMemory(resolveCustomDimensions({ hook_mutator: "on" }), undefined, shared, run);
    expect(shared).toEqual({ episodic: 3, semantic: 5 });
    expect(shaped.limits.episodic).toBe(99);
  });
});
