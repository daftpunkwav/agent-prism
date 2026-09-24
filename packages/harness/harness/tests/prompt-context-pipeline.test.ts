/**
 * @file prompt-context-pipeline tests
 * @description Covers fail-closed unknown ids and the shared context pipeline.
 *
 * Responsibilities:
 * - Lock fail-closed behavior for unknown prompt/context identifiers
 * - Lock pipeline order: strategy trim, sanitize, tool grounding
 */

import { describe, expect, it } from "vitest";
import { UnknownPromptConfigError } from "../src/prompt/errors.js";
import { buildPromptParts } from "../src/prompt/prompt-builder.js";
import { getReasoningDescription } from "../src/reasoning/reasoning-modes.js";
import { applyContextPipeline } from "../src/context/pipeline.js";
import { sanitizeAssistantMessage } from "../src/context/sanitize.js";

describe("prompt fail-closed", () => {
  it("throws on unknown prompt profile", () => {
    expect(() =>
      buildPromptParts({
        question: "hi",
        profile: "nope",
        reasoning: "react",
        harness: "bare",
        context: "sliding",
      }),
    ).toThrow(UnknownPromptConfigError);
  });

  it("throws on unknown reasoning mode", () => {
    expect(() => getReasoningDescription("nope")).toThrow(UnknownPromptConfigError);
  });

  it("builds a terse prompt that minimizes prose", () => {
    const parts = buildPromptParts({
      question: "compute 17!",
      profile: "terse",
      reasoning: "react",
      harness: "bare",
      context: "sliding",
    });
    expect(parts.system).toContain("minimal");
    expect(parts.user).toContain("concise");
    const plain = buildPromptParts({
      question: "compute 17!",
      profile: "zero_shot",
      reasoning: "react",
      harness: "bare",
      context: "sliding",
    });
    expect(parts.system.length).toBeGreaterThan(plain.system.length);
    expect(parts.system).not.toEqual(plain.system);
  });

  it("builds a valid zero_shot prompt", () => {
    const parts = buildPromptParts({
      question: "write snake.py",
      profile: "zero_shot",
      reasoning: "react",
      harness: "bare",
      context: "sliding",
      cwd: "/tmp/ws",
    });
    expect(parts.system).toContain("coding agent");
    expect(parts.user).toContain("write snake.py");
    expect(parts.user).toContain("/tmp/ws");
  });
});

describe("applyContextPipeline", () => {
  it("throws on unknown strategy", () => {
    expect(() => applyContextPipeline([{ role: "user", content: "a" }], "nope")).toThrow(UnknownPromptConfigError);
  });

  it("sanitizes and grounds sliding windows", () => {
    const out = applyContextPipeline(
      [
        { role: "system", content: "sys" },
        { role: "user", content: "task A" },
        { role: "user", content: "continue" },
      ],
      "sliding",
    );
    expect(out[0]?.role).toBe("system");
    expect(out[0]?.content).toContain("[Unique task]");
  });
});

describe("sanitizeAssistantMessage", () => {
  it("leaves textless tool calls without synthetic filler (models imitate filler verbatim)", () => {
    const out = sanitizeAssistantMessage({
      role: "assistant",
      content: "",
      toolCalls: [{ id: "1", name: "write", args: {} }],
    });
    expect(out.content).toBe("");
    expect(out.toolCalls).toHaveLength(1);
  });

  it("keeps visible text untouched", () => {
    const out = sanitizeAssistantMessage({ role: "assistant", content: "done" });
    expect(out.content).toBe("done");
    expect(out.toolCalls).toBeUndefined();
  });
});

describe("prompt time context", () => {
  const base = {
    question: "write snake.py",
    profile: "zero_shot",
    reasoning: "react",
    harness: "bare",
    context: "sliding",
  } as const;

  it("appends a UTC date line when now is injected", () => {
    const parts = buildPromptParts({ ...base, now: 1700000000000 });
    expect(parts.user).toContain("Today is 2023-11-14 (UTC).");
    expect(parts.user).toMatch(/Machine local timezone: UTC[+-]\d{2}:\d{2}; shell commands return local time\./);
  });

  it("stays timeless without now (replays keep old prompts byte-identical)", () => {
    const parts = buildPromptParts({ ...base });
    expect(parts.user).not.toContain("Today is");
    expect(parts.user).not.toContain("Machine local timezone");
  });

  it("ignores non-positive or non-finite instants fail-closed", () => {
    for (const now of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const parts = buildPromptParts({ ...base, now });
      expect(parts.user).not.toContain("Today is");
      expect(parts.user).not.toContain("Machine local timezone");
    }
  });
});
