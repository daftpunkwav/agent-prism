// @vitest-environment jsdom
/**
 * @file trace diff tests
 * @description Locks the cross-column comparison: verdict badges, tool-sequence divergence, file union, raw log.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ArenaEvent } from "@agentprism/client";
import type { ColumnState } from "@agentprism/arena-view";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { TraceDiff } from "../src/app/arena/TraceDiff.js";

function eventsA(): ArenaEvent[] {
  return [
    { type: "thought", content: "Answer A text", turn: 1, step: 1 },
    { type: "action", tool: "read", args: { path: "src/shared.ts" }, turn: 1, step: 2 },
    { type: "observation", tool: "read", result: "body", turn: 1, step: 2 },
  ] as unknown as ArenaEvent[];
}

function eventsB(): ArenaEvent[] {
  return [
    { type: "thought", content: "", turn: 1, step: 1 },
    { type: "action", tool: "grep", args: { pattern: "x" }, turn: 1, step: 1 },
    { type: "observation", tool: "grep", result: "hit", turn: 1, step: 1 },
    { type: "action", tool: "read", args: { path: "src/shared.ts" }, turn: 1, step: 2 },
    { type: "observation", tool: "read", result: "body", turn: 1, step: 2 },
    { type: "action", tool: "read", args: { path: "src/only-b.ts" }, turn: 1, step: 2 },
  ] as unknown as ArenaEvent[];
}

function col(label: string, events: ArenaEvent[], success: boolean): ColumnState {
  return {
    label,
    frameworkId: "native",
    events,
    metrics: { success, duration_ms: 1200, total_tokens: 4200, tool_calls: events.filter((e) => e.type === "action").length, steps: 3 },
  } as unknown as ColumnState;
}

afterEach(cleanup);

function renderDiff(columns: ColumnState[]) {
  return render(
    <I18nProvider initialLocale="en">
      <TraceDiff columns={columns} />
    </I18nProvider>,
  );
}

describe("TraceDiff", () => {
  it("renders nothing without columns", () => {
    const { container } = renderDiff([]);
    expect(container.firstElementChild).toBeNull();
  });

  it("compares two columns and marks the tool-sequence divergence", () => {
    const en = () => getCatalog("en").arena.diff;
    renderDiff([col("Native", eventsA(), true), col("LangChain", eventsB(), false)]);
    expect(screen.getByText(getCatalog("en").arena.tab.diff)).toBeDefined();
    // First tools differ (read_file vs grep): the badge shows the common prefix length.
    expect(screen.getByText(en().commonPrefix.replace("{count}", "0"))).toBeDefined();
    expect(screen.getAllByText(en().difference).length).toBeGreaterThanOrEqual(1);
    // Verdict badges per column.
    expect(screen.getByText(getCatalog("en").arena.report.success)).toBeDefined();
    expect(screen.getByText(getCatalog("en").arena.report.failed)).toBeDefined();
    // Tool sequences and per-column answers.
    expect(screen.getAllByText("read").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Answer A text").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(en().noAnswer)).toBeDefined();
  });

  it("unions touched files and flags shared vs single-producer paths", () => {
    const en = () => getCatalog("en").arena.diff;
    renderDiff([col("Native", eventsA(), true), col("LangChain", eventsB(), false)]);
    expect(screen.getAllByText("src/shared.ts").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("src/only-b.ts").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(new RegExp(en().sharedFile))).toBeDefined();
    expect(screen.getByText(en().onlyIn.replace("{label}", "LangChain"))).toBeDefined();
  });

  it("renders the single-column variant without the file union table", () => {
    const en = () => getCatalog("en").arena.diff;
    renderDiff([col("Native", eventsA(), true)]);
    expect(screen.getByText(en().singleColumn)).toBeDefined();
    expect(screen.queryByText(en().fileUnionTitle)).toBeNull();
  });

  it("exposes the step detail and raw event log per column", () => {
    renderDiff([col("Native", eventsA(), true)]);
    expect(screen.getByText(getCatalog("en").arena.diff.rawLogTitle)).toBeDefined();
    expect(screen.getByText(/3 events/)).toBeDefined();
  });
});
