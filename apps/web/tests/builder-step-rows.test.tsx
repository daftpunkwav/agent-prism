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
  it("keeps command content out of the collapsed summary row", () => {
    renderSteps([actionSegment({})]);
    const summary = screen.getByText("bash").closest("summary");
    expect(summary).not.toBeNull();
    expect(summary?.textContent).not.toContain("Get-ChildItem");
    // The command stays reachable through the expandable args body.
    const body = summary?.parentElement?.querySelector("pre");
    expect(body?.textContent).toContain("Get-ChildItem");
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
