// @vitest-environment jsdom
/**
 * @file arena auto judge tests
 * @description Verifies useArenaAutoJudge prevents empty-question triggers and duplicate judge calls.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import React from "react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { useArenaAutoJudge } from "../src/app/arena/useArenaAutoJudge";
import type { TaskTemplate } from "@agentprism/client";
import type { ColumnState } from "@agentprism/arena-view";
import * as clientModule from "@agentprism/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockTemplates: TaskTemplate[] = [
  {
    id: "tpl-code",
    name: "Code Gen",
    description: "test",
    question: "write code",
    suggested_dimension: "framework",
    suggested_selections: ["native"],
    category: "scored",
    judge: {
      type: "keyword",
      any_of: ["Hello"],
      all_of: [],
      min_hits: 1,
      required_fields: [],
      must_contain: [],
      max_len: 8000,
      operator: "==",
      value: 0,
      tolerance: 0,
      patterns: [],
      pattern: "",
      rubric: "",
      passing_score: 0.5,
      judge_model: "",
    },
  },
];

const mockColumn: ColumnState = {
  label: "native",
  events: [
    {
      type: "thought",
      pipeline: "native",
      content: "thinking",
      workspace: "",
      tool: "",
      args: {},
      result: "",
      step: 0,
      passed: null,
      reason: "",
      metrics: null,
      message: "",
      token_stats: null,
      turn: 1,
      runId: "r-1",
      timestamp: 1000,
    },
    {
      type: "action",
      pipeline: "native",
      content: "",
      workspace: "",
      tool: "final_answer",
      args: { answer: "Hello world!" },
      result: "",
      step: 1,
      passed: null,
      reason: "",
      metrics: null,
      message: "",
      token_stats: null,
      turn: 1,
      runId: "r-1",
      timestamp: 1001,
    },
  ],
};

describe("useArenaAutoJudge", () => {
  it("does not trigger judgeAnswers when question is empty", () => {
    const judgeSpy = vi.spyOn(clientModule, "judgeAnswers").mockResolvedValue({});
    const applyJudgeResults = vi.fn();
    const setError = vi.fn();

    renderHook(
      () =>
        useArenaAutoJudge({
          allCompleted: true,
          activeTemplateId: "tpl-code",
          templates: mockTemplates,
          question: "",
          columnList: [mockColumn],
          applyJudgeResults,
          setError,
        }),
      {
        wrapper: ({ children }) => React.createElement(I18nProvider, { initialLocale: "en", children }),
      },
    );

    expect(judgeSpy).not.toHaveBeenCalled();
  });

  it("triggers judgeAnswers once for non-empty question and does not duplicate when question is cleared", async () => {
    const judgeSpy = vi.spyOn(clientModule, "judgeAnswers").mockResolvedValue({
      native: { passed: true, reason: "good", details: [] },
    });
    const applyJudgeResults = vi.fn();
    const setError = vi.fn();

    const { rerender } = renderHook(
      (props) => useArenaAutoJudge(props),
      {
        wrapper: ({ children }) => React.createElement(I18nProvider, { initialLocale: "en", children }),
        initialProps: {
          allCompleted: true,
          activeTemplateId: "tpl-code",
          templates: mockTemplates,
          question: "write code",
          columnList: [mockColumn],
          applyJudgeResults,
          setError,
        },
      },
    );

    expect(judgeSpy).toHaveBeenCalledTimes(1);

    // Simulate commit clearing question
    rerender({
      allCompleted: true,
      activeTemplateId: "tpl-code",
      templates: mockTemplates,
      question: "",
      columnList: [mockColumn],
      applyJudgeResults,
      setError,
    });

    // Should still only have been called once, not twice
    expect(judgeSpy).toHaveBeenCalledTimes(1);
  });
});
