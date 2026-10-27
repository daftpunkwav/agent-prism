// @vitest-environment jsdom
/**
 * @file builder step rows tests
 * @description Locks the collapsed tool-call row: command content only opens
 * inside the args body, while short path/pattern details stay on the row.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DisplaySegment } from "@agentprism/arena-view";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { StepRows } from "../src/app/builder/ChatPanel.js";

afterEach(() => cleanup());

function actionSegment(overrides: Partial<DisplaySegment>): DisplaySegment {
  return {
    id: "a1",
    kind: "action",
    step: 1,
    turn: 1,
    text: "",
    tool: "bash",
    args: { command: "Get-ChildItem -Force -Path . | Select-Object Name, Length; Write-Output done" },
    result: "ok",
    completed: true,
    ...overrides,
  };
}

function renderSteps(segments: DisplaySegment[]) {
  return render(
    <I18nProvider initialLocale="en">
      <StepRows segments={segments} />
    </I18nProvider>,
  );
}

describe("builder step rows", () => {
  const COMMAND = "Get-ChildItem -Force -Path . | Select-Object Name, Length; Write-Output done";

  function assertCollapsedRowHidesCommand(summary: Element | null, tool: string): void {
    expect(summary).not.toBeNull();
    // The row must still be collapsed: an open-by-default details element would
    // put the command on screen without any expansion.
    const details = summary?.parentElement as HTMLDetailsElement | null;
    expect(details?.open).toBe(false);
    // Exact match: any leaked slice of the command (prefix, suffix, truncated)
    // changes the text and fails, while the expected labels stay exactly these.
    expect(getCatalog("en").builder.actionDone).toBe("done");
    expect(summary?.textContent?.replace(/\s+/g, "")).toBe(`${tool}done`);
  }

  it("keeps command content out of the collapsed summary row", () => {
    renderSteps([actionSegment({})]);
    const summary = screen.getByText("bash").closest("summary");
    assertCollapsedRowHidesCommand(summary, "bash");
    // The command stays reachable through the expandable args body.
    const body = summary?.parentElement?.querySelector("pre");
    expect(body?.textContent).toContain(COMMAND);
  });

  it("keeps legacy cmd-key commands out of the collapsed summary row", () => {
    renderSteps([actionSegment({ id: "a4", args: { cmd: COMMAND } })]);
    assertCollapsedRowHidesCommand(screen.getByText("bash").closest("summary"), "bash");
  });

  it("drops command content stored under an unknown key entirely", () => {
    renderSteps([actionSegment({ id: "a5", args: { script: COMMAND } })]);
    assertCollapsedRowHidesCommand(screen.getByText("bash").closest("summary"), "bash");
  });

  it("drops unknown-key arguments even when they are short", () => {
    renderSteps([actionSegment({ id: "a6", args: { task: "git status" } })]);
    assertCollapsedRowHidesCommand(screen.getByText("bash").closest("summary"), "bash");
  });

  it("prefers the query target over the action verb", () => {
    renderSteps([actionSegment({ id: "a7", tool: "symbols", args: { action: "search", query: "parser" } })]);
    const summary = screen.getByText("symbols").closest("summary");
    expect(summary?.textContent).toContain("parser");
    expect(summary?.textContent).not.toContain("search");
  });

  it("shows the job id on a polled job row", () => {
    renderSteps([actionSegment({ id: "a8", tool: "run_job", args: { action: "poll", job_id: "j-7" } })]);
    const summary = screen.getByText("run_job").closest("summary");
    expect(summary?.textContent).toContain("j-7");
  });

  it("still shows short path details on the summary row", () => {
    renderSteps([actionSegment({ id: "a2", tool: "read", args: { path: "README.md" } })]);
    const summary = screen.getByText("read").closest("summary");
    expect(summary?.textContent).toContain("README.md");
  });

  it("keeps short non-command argument details on the summary row", () => {
    renderSteps([actionSegment({ id: "a3", tool: "glob", args: { pattern: "**/*" } })]);
    const summary = screen.getByText("glob").closest("summary");
    expect(summary?.textContent).toContain("**/*");
  });
});
