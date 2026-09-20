// @vitest-environment jsdom
/**
 * @file arena custom lane tests
 * @description Locks the custom-value lane adder for numeric comparison dimensions.
 *
 * Responsibilities:
 * - Pin in-range commit, out-of-range rejection, and unlimited-token pass-through
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { ArenaSetupModule } from "../src/app/arena/ArenaSetupModule.js";
import type { ArenaMeta, DimensionMeta } from "@agentprism/client";

afterEach(() => {
  cleanup();
});

const STEPS_DIMENSION: DimensionMeta = {
  id: "max_steps",
  label: "Max steps",
  subtitle: "",
  min_select: 1,
  max_select: 16,
  options: [
    { field: "max_steps", value: "5", label: "5 steps" },
    { field: "max_steps", value: "10", label: "10 steps" },
    { field: "max_steps", value: "15", label: "15 steps" },
    { field: "max_steps", value: "20", label: "20 steps" },
  ],
};

function metaWith(): ArenaMeta {
  return {
    dimensions: [STEPS_DIMENSION],
    frameworks: [],
    baseline_defaults: { max_steps: "10" },
    baseline_fields: [
      {
        dimension: "max_steps",
        field: "max_steps",
        label: "Max steps",
        group: "pipeline",
        default: "10",
        options: STEPS_DIMENSION.options,
        input: "number",
        min: 1,
        max: 100000,
        step: 1,
        allow_unlimited: true,
      },
    ],
    model_compare_ready: true,
  } as unknown as ArenaMeta;
}

function renderSetup(onToggleSelection: (value: string) => void, selections: string[]) {
  return render(
    <I18nProvider initialLocale="en">
      <ArenaSetupModule
        baselineOpen={false}
        onOpenBaseline={() => {}}
        running={false}
        meta={metaWith()}
        dimension="max_steps"
        onDimensionChange={() => {}}
        activeDim={STEPS_DIMENSION}
        activeSelections={selections}
        onToggleSelection={onToggleSelection}
        showLeftPanel={false}
        onToggleLeftPanel={() => {}}
        showRightPanel={false}
        onToggleRightPanel={() => {}}
      />
    </I18nProvider>,
  );
}

describe("custom lane adder", () => {
  it("commits an in-range custom value on Enter", () => {
    const onToggle = vi.fn();
    renderSetup(onToggle, ["5", "10"]);
    const input = screen.getByLabelText("Add a custom comparison value") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onToggle).toHaveBeenCalledWith("7");
  });

  it("commits the unlimited token for max steps", () => {
    const onToggle = vi.fn();
    renderSetup(onToggle, ["5"]);
    const input = screen.getByLabelText("Add a custom comparison value") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "UNLIMITED" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onToggle).toHaveBeenCalledWith("unlimited");
  });

  it("rejects out-of-range values without committing", () => {
    const onToggle = vi.fn();
    renderSetup(onToggle, ["5"]);
    const input = screen.getByLabelText("Add a custom comparison value") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onToggle).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("does not re-add an already selected value", () => {
    const onToggle = vi.fn();
    renderSetup(onToggle, ["5", "10", "7"]);
    const input = screen.getByLabelText("Add a custom comparison value") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("renders extra tiles for custom selections with localized labels", () => {
    renderSetup(() => {}, ["5", "7"]);
    expect(screen.getByRole("button", { name: "7 steps" })).toBeDefined();
    expect(screen.getByRole("button", { name: "5 steps" })).toBeDefined();
  });
});
