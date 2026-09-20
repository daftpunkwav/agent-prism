// @vitest-environment jsdom
/**
 * @file logs diff wire tests
 * @description Locks the wire/raw-log comparison: view toggle, wire records, event lines, and empty states.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { fetchColumnLogs, type ColumnLogs } from "@agentprism/client";
import type { ColumnState } from "@agentprism/arena-view";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { LogsDiff } from "../src/app/arena/LogsDiff.js";

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  fetchColumnLogs: vi.fn(),
}));

const logsMock = vi.mocked(fetchColumnLogs);

const LOGS: ColumnLogs = {
  wire: [
    {
      seq: 1,
      turn: 1,
      record: {
        kind: "llm_request",
        data: {
          model: "glm-5.3",
          messages: [
            { role: "system", content: "be helpful", tool_calls: [] },
            { role: "user", content: "question", tool_calls: [] },
          ],
          tools: ["read", "write"],
        },
        durationMs: null,
      },
    },
    {
      seq: 2,
      turn: 1,
      record: {
        kind: "llm_response",
        data: { model: "glm-5.3", text: "the answer", reasoning: "because", tool_calls: [{ id: "c" }], usage: { total_tokens: 42 } },
        durationMs: 850,
      },
    },
  ],
  events: [
    { type: "step_start", turn: 1, step: 1 },
    { type: "action", turn: 1, step: 2, tool: "read", content: "" },
  ],
  truncated: false,
} as unknown as ColumnLogs;

function col(label: string, workspace?: string): ColumnState {
  return { label, frameworkId: "native", events: [], workspace } as ColumnState;
}

const en = () => getCatalog("en").arena.logs;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderLogs(props: { columns?: ColumnState[]; running?: boolean } = {}) {
  return render(
    <I18nProvider initialLocale="en">
      <LogsDiff
        columns={props.columns ?? [col("Native", "ws-native")]}
        running={props.running ?? false}
      />
    </I18nProvider>,
  );
}

describe("LogsDiff", () => {
  it("shows the all-empty state without columns", () => {
    renderLogs({ columns: [] });
    expect(screen.getByText(en().emptyAll)).toBeDefined();
  });

  it("renders wire records for a workspace column", async () => {
    logsMock.mockResolvedValue(LOGS);
    renderLogs();
    expect((await screen.findAllByText("glm-5.3")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(en().kindRequest)).toBeDefined();
    expect(screen.getByText(en().kindResponse)).toBeDefined();
    expect(screen.getAllByText(/850ms/).length).toBeGreaterThanOrEqual(1);
  });

  it("toggles to the raw-events view and renders one line per event", async () => {
    logsMock.mockResolvedValue(LOGS);
    renderLogs();
    await screen.findAllByText("glm-5.3");
    fireEvent.click(screen.getByRole("button", { name: en().viewEvents }));
    expect(await screen.findByText(/t1\/s1 · step_start/)).toBeDefined();
    expect(screen.getByText(/t1\/s2 · action · read/)).toBeDefined();
  });

  it("renders the empty views when a column has no logs", async () => {
    logsMock.mockResolvedValue({ wire: [], events: [], truncated: false } as unknown as ColumnLogs);
    renderLogs();
    expect(await screen.findByText(en().emptyWire)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: en().viewEvents }));
    expect(await screen.findByText(en().emptyEvents)).toBeDefined();
  });

  it("flags columns without a workspace instead of polling", async () => {
    renderLogs({ columns: [col("Native")] });
    expect(await screen.findByText(en().needWorkspace)).toBeDefined();
    expect(logsMock).not.toHaveBeenCalled();
  });

  it("shows the loading state until the first poll resolves", async () => {
    logsMock.mockReturnValue(new Promise(() => {}));
    renderLogs();
    expect(await screen.findByText(en().loading)).toBeDefined();
  });
});
