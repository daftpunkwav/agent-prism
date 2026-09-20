/**
 * @file sanitize tests
 * @description Covers message sanitization before model calls.
 *
 * Responsibilities:
 * - Pin assistant history cleanup (text plus toolCalls, no synthetic filler)
 * - Pin system-message flattening: prefix merge, non-prefix supplement conversion
 * - Pin the combined sanitizeMessagesForModel pass over mixed histories
 */

import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@agentprism/contracts";
import {
  flattenSystemMessagesForProvider,
  sanitizeAssistantMessage,
  sanitizeMessagesForModel,
} from "../../src/context/sanitize.js";

describe("sanitizeAssistantMessage", () => {
  it("keeps text and drops empty toolCall arrays", () => {
    const out = sanitizeAssistantMessage({ role: "assistant", content: "answer", toolCalls: [] });
    expect(out).toEqual({ role: "assistant", content: "answer", toolCalls: undefined });
  });

  it("keeps tool calls and adds no synthetic filler for textless calls", () => {
    const calls = [{ id: "c1", name: "read", args: { path: "a.ts" } }];
    const out = sanitizeAssistantMessage({ role: "assistant", content: "", toolCalls: calls });
    expect(out.content).toBe("");
    expect(out.toolCalls).toEqual(calls);
  });
});

describe("flattenSystemMessagesForProvider", () => {
  it("merges prefix system messages into one turn", () => {
    const out = flattenSystemMessagesForProvider([
      { role: "system", content: "first" },
      { role: "system", content: "second" },
      { role: "user", content: "hi" },
    ]);
    expect(out).toEqual([
      { role: "system", content: "first\n\nsecond" },
      { role: "user", content: "hi" },
    ]);
  });

  it("converts a non-prefix system message into a user supplement", () => {
    const out = flattenSystemMessagesForProvider([
      { role: "system", content: "prefix" },
      { role: "user", content: "hi" },
      { role: "system", content: "mid-run update" },
    ]);
    expect(out).toEqual([
      { role: "system", content: "prefix" },
      { role: "user", content: "hi" },
      { role: "user", content: "[System supplement]\nmid-run update" },
    ]);
  });

  it("drops empty non-prefix supplements and passes other roles through", () => {
    const out = flattenSystemMessagesForProvider([
      { role: "user", content: "q" },
      { role: "system", content: "   " },
      { role: "assistant", content: "a" },
    ]);
    expect(out).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "a" },
    ]);
  });
});

describe("sanitizeMessagesForModel", () => {
  it("runs both passes over a mixed history without mutating the input", () => {
    const input: LlmMessage[] = [
      { role: "system", content: "rules" },
      { role: "system", content: "more rules" },
      { role: "user", content: "go" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "ls", args: {} }] },
      { role: "system", content: "notice" },
    ];
    const snapshot = JSON.stringify(input);
    const out = sanitizeMessagesForModel(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out).toEqual([
      { role: "system", content: "rules\n\nmore rules" },
      { role: "user", content: "go" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "ls", args: {} }] },
      { role: "user", content: "[System supplement]\nnotice" },
    ]);
  });
});
