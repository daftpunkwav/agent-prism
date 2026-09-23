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
      result.current.beginTurn(1, "Explain recursion");
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
});
