/**
 * @file ask-user-normalize tests
 * @description Locks shared ask_user coercion: nested options flatten, scalars split/stringify.
 */
import { describe, expect, it } from "vitest";
import {
  lowerAskUserKeys,
  normalizeAskUserBatchArgs,
  normalizeAskUserOptions,
  unwrapAskUserInput,
} from "../src/tool-registry.js";

describe("normalizeAskUserOptions", () => {
  it("flattens nested arrays (the observed options[0]-array failure)", () => {
    expect(normalizeAskUserOptions([["A", "B"]])).toEqual(["A", "B"]);
    expect(normalizeAskUserOptions([[["A"]], "B"])).toEqual(["A", "B"]);
  });

  it("passes non-arrays through untouched (the parser still rejects them)", () => {
    expect(normalizeAskUserOptions("yes, no")).toBe("yes, no");
    expect(normalizeAskUserOptions(null)).toBe(null);
    expect(normalizeAskUserOptions([])).toEqual([]);
  });
});

describe("lowerAskUserKeys", () => {
  it("lowercases keys without touching values", () => {
    expect(lowerAskUserKeys({ QUESTIONS: [1], Id: "a" })).toEqual({ questions: [1], id: "a" });
  });
});

describe("unwrapAskUserInput", () => {
  const batch = { questions: [{ id: "test1", question: "可用?", options: ["收到", "未收到"] }] };
  it("unwraps a stringified batch under input (observed LangChain shape)", () => {
    expect(unwrapAskUserInput({ input: JSON.stringify(batch) })).toEqual(batch);
  });

  it("leaves explicit questions untouched even when input exists", () => {
    expect(unwrapAskUserInput({ questions: [], input: JSON.stringify(batch) })).toEqual({
      questions: [],
      input: JSON.stringify(batch),
    });
  });

  it("wraps a bare single question and passes garbage through", () => {
    expect(unwrapAskUserInput({ question: "hi?" })).toEqual({ questions: [{ question: "hi?" }] });
    expect(unwrapAskUserInput({ input: "not-json{{{" })).toEqual({ input: "not-json{{{" });
    expect(unwrapAskUserInput({})).toEqual({});
  });
});

describe("normalizeAskUserBatchArgs", () => {
  it("lowercases then unwraps (cased wrapper around cased payload)", () => {
    const upper = { INPUT: JSON.stringify({ QUESTIONS: [{ ID: "T", QUESTION: "Q?" }] }) };
    expect(normalizeAskUserBatchArgs(upper as Record<string, unknown>)).toEqual({
      questions: [{ id: "T", question: "Q?" }],
    });
  });
});
