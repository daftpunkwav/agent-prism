// @vitest-environment jsdom
/**
 * @file trace view tests
 * @description Locks the trace timeline: banner chips, tool rows, observations, errors, multi-turn grouping.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ArenaEvent } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { TraceView } from "../src/app/arena/TraceView.js";

const BANNER = "[Native Agent] react · prompt=zero_shot · temperature=0.7";

function events(): ArenaEvent[] {
  return [
    { type: "thought", content: BANNER, turn: 1, step: 0 },
    { type: "thinking", content: "inner monologue", turn: 1, step: 1 },
    { type: "thought", content: "Reading the repo first.", turn: 1, step: 1 },
    { type: "action", tool: "read", args: { path: "src/a.ts" }, turn: 1, step: 2 },
    { type: "observation", tool: "read", result: "file body", turn: 1, step: 2 },
    { type: "file_diff", content: "--- a\n+++ b", turn: 1, step: 3 },
    { type: "thought", content: "Final answer text", turn: 2, step: 1 },
  ] as unknown as ArenaEvent[];
}

afterEach(cleanup);

function renderTrace(props: { events?: ArenaEvent[]; running?: boolean } = {}) {
  return render(
    <I18nProvider initialLocale="en">
      <TraceView events={props.events ?? events()} running={props.running ?? false} colorIndex={1} frameworkId="native" />
    </I18nProvider>,
  );
}

describe("TraceView", () => {
  it("renders the legend and groups a multi-turn timeline by turn", () => {
    const { container } = renderTrace();
    expect(container.querySelector(".trace-legend")).not.toBeNull();
    const turnLabel = getCatalog("en").arena.trace.turn;
    expect(screen.getByText(turnLabel.replace("{turn}", "1"))).toBeDefined();
    expect(screen.getByText(turnLabel.replace("{turn}", "2"))).toBeDefined();
    expect(screen.getAllByText("Final answer text").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the banner as framework chips instead of raw text", () => {
    renderTrace();
    const banner = document.querySelector('details[data-kind="banner"] summary');
    expect(banner?.textContent).toContain("Native Agent");
    expect(screen.getAllByText("zero_shot").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the tool call with its category and detail, folding in the observation", () => {
    const { container } = renderTrace();
    const action = document.querySelector('details[data-kind="tool"][data-category="read"]');
    expect(action?.textContent).toContain("read");
    expect(action?.textContent).toContain("src/a.ts");
    expect(container.textContent).toContain("file body");
  });

  it("renders file diffs and errors distinctly", () => {
    const { container } = renderTrace({
      events: [
        ...events(),
        { type: "error", message: "route down", content: "route down", turn: 2, step: 2 } as unknown as ArenaEvent,
      ],
    });
    expect(screen.getAllByText(getCatalog("en").arena.trace.fileDiff).length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll('.trace-seg[data-kind="error"]').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("route down")).toBeDefined();
  });

  it("keeps thinking collapsed and annotated with its length", () => {
    renderTrace();
    const thinking = document.querySelector('details[data-kind="thinking"]');
    expect(thinking?.textContent).toContain(String("inner monologue".length));
  });

  it("renders verify/reflect meta rows, tool progress, ls listings, and orphan observations", () => {
    const { container } = renderTrace({
      events: [
        { type: "verify", content: "checks passed", turn: 1, step: 1 },
        { type: "reflect", content: "retry with plan b", turn: 1, step: 1 },
        { type: "harness_edit", content: "prompt adjusted", turn: 1, step: 1 },
        { type: "tool_progress", tool: "run", content: "compiling...", turn: 1, step: 2 },
        { type: "action", tool: "ls", args: {}, turn: 1, step: 3 },
        { type: "observation", tool: "ls", result: "a.ts\nb.ts", turn: 1, step: 3 },
        // A stray second observation stays standalone and renders as a file list.
        { type: "observation", tool: "ls", result: "a.ts\nb.ts", turn: 1, step: 4 },
      ] as unknown as ArenaEvent[],
    });
    expect(screen.getByText(getCatalog("en").arena.trace.verify)).toBeDefined();
    expect(screen.getByText(getCatalog("en").arena.trace.reflect)).toBeDefined();
    expect(screen.getByText(getCatalog("en").arena.trace.harnessEdit)).toBeDefined();
    expect(screen.getByText(getCatalog("en").arena.trace.toolProgress)).toBeDefined();
    expect(screen.getByText(/compiling.../)).toBeDefined();
    // ls results render as a mono file list instead of markdown.
    expect(screen.getByText(getCatalog("en").arena.trace.fileList)).toBeDefined();
    expect(container.textContent).toContain("a.ts\nb.ts");
  });

  it("folds an observation into its action when result follows the call", () => {
    const { container } = renderTrace({
      events: [
        { type: "action", tool: "read", args: { path: "x.ts" }, turn: 1, step: 1 },
        { type: "observation", tool: "read", result: "x body", turn: 1, step: 1 },
      ] as unknown as ArenaEvent[],
    });
    const action = container.querySelector('details[data-kind="tool"]');
    expect(action?.textContent).toContain("x body");
    expect(action?.textContent).toContain(getCatalog("en").arena.trace.actionDone);
  });

  it("shows a live pending step marker only while the model call is unfinished", () => {
    const { container } = renderTrace({
      running: true,
      events: [{ type: "step_start", turn: 1, step: 2 } as unknown as ArenaEvent],
    });
    expect(container.querySelector(".trace-step-pending")).not.toBeNull();
    expect(screen.getByText(getCatalog("en").arena.trace.modelCallStep.replace("{step}", "2"))).toBeDefined();
  });

  it("labels every model-output segment with the single stable output badge", () => {
    renderTrace({
      events: [
        { type: "thought", content: "first pass", turn: 1, step: 1 },
        { type: "thought", content: "settled final text", turn: 1, step: 2 },
      ] as unknown as ArenaEvent[],
    });
    // Multi-turn agents produce many output segments; the badge must stay
    // stable ("Output") instead of flickering between interim/final labels.
    // The interim visual de-emphasis still distinguishes earlier segments.
    expect(screen.getAllByText(getCatalog("en").arena.trace.output)).toHaveLength(2);
    expect(screen.getByText("settled final text")).toBeDefined();
  });

  it("shows the waiting row while running with no events", () => {
    vi.useFakeTimers();
    renderTrace({ events: [], running: true });
    const expected = getCatalog("en").arena.trace.waitingModel.replace("{seconds}", "0");
    expect(screen.getByText(expected)).toBeDefined();
    vi.useRealTimers();
  });

  it("renders nothing but the container without events and not running", () => {
    const { container } = renderTrace({ events: [], running: false });
    expect(container.querySelector(".trace-legend")).toBeNull();
    expect(container.querySelector(".trace-timeline")?.children).toHaveLength(0);
  });
});
