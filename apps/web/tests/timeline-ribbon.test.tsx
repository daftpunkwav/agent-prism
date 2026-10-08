// @vitest-environment jsdom
/**
 * @file timeline ribbon tests
 * @description Keeps each segment's tooltip reference unique and stable across row updates.
 */

import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ColumnState } from "@agentprism/arena-view";
import { I18nProvider } from "@/i18n/I18nProvider";
import { TimelineRibbonView } from "../src/app/arena/TimelineRibbonView.js";

afterEach(cleanup);

const column = (label: string): ColumnState => ({
  label,
  frameworkId: "native",
  events: [
    { type: "thought", pipeline: label, content: `Thinking for ${label}` },
    { type: "action", pipeline: label, tool: "search", args: {} },
  ],
}) as unknown as ColumnState;

function ribbons(columns: ColumnState[]) {
  return (
    <I18nProvider initialLocale="en">
      <TimelineRibbonView columnList={columns} resolveDisplayLabel={(label) => label} />
      <TimelineRibbonView columnList={columns} resolveDisplayLabel={(label) => label} />
    </I18nProvider>
  );
}

it("links each segment to its own tooltip even when labels normalize identically", () => {
  const columns = [column("a b"), column("a-b")];
  const { container, rerender } = render(ribbons(columns));
  const buttons = () => Array.from(container.querySelectorAll("button.arena-ribbon-seg"));
  const ids = () => buttons().map((button) => button.getAttribute("aria-describedby"));

  expect(buttons()).toHaveLength(8);
  expect(new Set(ids()).size).toBe(8);
  for (const button of buttons()) {
    const tooltip = button.querySelector('[role="tooltip"]');
    const id = button.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(id).not.toMatch(/\s/);
    expect(tooltip?.id).toBe(id);
    expect(document.getElementById(id ?? "")).toBe(tooltip);
  }

  const before = ids();
  rerender(ribbons([...columns].reverse()));
  expect(ids()).toEqual([
    ...before.slice(2, 4), ...before.slice(0, 2),
    ...before.slice(6, 8), ...before.slice(4, 6),
  ]);
});
