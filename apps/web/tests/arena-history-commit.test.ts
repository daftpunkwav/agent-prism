// @vitest-environment jsdom
/**
 * @file arena history commit tests
 * @description Verifies history commit handles columns with errors properly.
 */

import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { useHistoryCommit } from "../src/app/arena/useHistoryCommit";
import type { ColumnState } from "@agentprism/arena-view";

describe("useHistoryCommit", () => {
  it("commits turn for column with error even when metrics are missing", () => {
    const pushColumnTurn = vi.fn();
    const rememberWorkspace = vi.fn();
    const onCommitted = vi.fn();

    const erroredColumn: ColumnState = {
      label: "col-failed",
      events: [],
      error: "Connection dropped",
      // metrics undefined
    };

    const { result, rerender } = renderHook(
      (props) => useHistoryCommit(props),
      {
        wrapper: ({ children }) => React.createElement(I18nProvider, { initialLocale: "en", children }),
        initialProps: {
          running: true,
          allSettled: false,
          columns: { "col-failed": erroredColumn },
          columnList: [erroredColumn],
          pushColumnTurn,
          rememberWorkspace,
          onCommitted,
        },
      },
    );

    act(() => {
      result.current.beginTurn({ "col-failed": 1 }, "Explain recursion");
    });

    expect(pushColumnTurn).not.toHaveBeenCalled();

    // Now turn finishes and allSettled becomes true
    rerender({
      running: false,
      allSettled: true,
      columns: { "col-failed": erroredColumn },
      columnList: [erroredColumn],
      pushColumnTurn,
      rememberWorkspace,
      onCommitted,
    });

    expect(pushColumnTurn).toHaveBeenCalledWith(
      "col-failed",
      "Explain recursion",
      "Connection dropped",
      [],
    );
    expect(onCommitted).toHaveBeenCalled();
  });

  it("commits only the pending turn's tool rounds, not earlier turns' events", () => {
    const pushColumnTurn = vi.fn();
    const rememberWorkspace = vi.fn();
    const onCommitted = vi.fn();

    // col.events keeps earlier completed turns for the trace view; the earlier
    // turn's rounds must not ride onto this turn's assistant entry again.
    const base = { pipeline: "col-a", agentId: "agent-1", runId: "run-1", step: 1, passed: null, metrics: null, token_stats: null };
    const action = (turn: number, tool: string, result: string) => ({ ...base, turn, type: "action", tool, args: {}, result });
    const observation = (turn: number, tool: string, result: string) => ({ ...base, turn, type: "observation", tool, args: {}, result });
    const column: ColumnState = {
      label: "col-a",
      // A settled column needs metrics (success) or an error to be committed.
      metrics: { success: true, duration_ms: 1, input_tokens: 0, output_tokens: 0, total_tokens: 0, tool_calls: 0, steps: 1 } as ColumnState["metrics"],
      events: [
        action(1, "read", "old turn body"),
        observation(1, "read", "old turn body"),
        action(2, "run", "new turn output"),
        observation(2, "run", "new turn output"),
      ] as unknown as ColumnState["events"],
    };

    const { result, rerender } = renderHook(
      (props) => useHistoryCommit(props),
      {
        wrapper: ({ children }) => React.createElement(I18nProvider, { initialLocale: "en", children }),
        initialProps: {
          running: true,
          allSettled: false,
          columns: { "col-a": column },
          columnList: [column],
          pushColumnTurn,
          rememberWorkspace,
          onCommitted,
        },
      },
    );

    act(() => {
      result.current.beginTurn({ "col-a": 2 }, "follow up");
    });

    rerender({
      running: false,
      allSettled: true,
      columns: { "col-a": column },
      columnList: [column],
      pushColumnTurn,
      rememberWorkspace,
      onCommitted,
    });

    const rounds = pushColumnTurn.mock.calls[0]?.[3] as Array<{ tool: string; result: string }>;
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toEqual({ tool: "run", args: {}, result: "new turn output" });
  });
});
