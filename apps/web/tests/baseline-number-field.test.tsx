// @vitest-environment jsdom
/**
 * @file baseline number field tests
 * @description Locks numeric baseline inputs: rendering, validation, commit.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { BaselineModal } from "../src/app/arena/BaselineModal.js";
import type { ArenaMeta } from "@agentprism/client";

afterEach(() => {
  cleanup();
});

function metaWith(): ArenaMeta {
  return {
    dimensions: [],
    frameworks: [],
    baseline_defaults: { temperature: "0", top_p: "1" },
    baseline_fields: [
      {
        dimension: "temperature",
        field: "temperature",
        label: "Temperature",
        group: "decode",
        default: "0",
        options: [{ value: "0", label: "0" }],
        input: "number",
        min: 0,
        max: 2,
        step: 0.05,
      },
      {
        dimension: null,
        field: "approval_mode",
        label: "Approval mode",
        group: "pipeline",
        default: "auto",
        options: [{ value: "auto", label: "Auto" }],
        input: "select",
        min: null,
        max: null,
        step: null,
      },
    ],
    model_compare_ready: true,
  } as unknown as ArenaMeta;
}

function renderModal(onBaselineFieldChange: (field: string, value: string) => void, baseline: Record<string, string> = {}) {
  return render(
    <I18nProvider initialLocale="en">
      <BaselineModal
        open
        onClose={() => {}}
        running={false}
        meta={metaWith()}
        dimension="framework"
        baseline={baseline as never}
        onBaselineFieldChange={onBaselineFieldChange}
        showPromptBanner={false}
        onDismissPromptBanner={() => {}}
      />
    </I18nProvider>,
  );
}

describe("baseline numeric fields", () => {
  it("renders a numeric input for number-kind fields and a select otherwise", () => {
    renderModal(() => {});
    expect(screen.getByLabelText("Baseline Temperature")).toBeDefined();
    // Approval mode stays a dropdown.
    expect(screen.getByLabelText("Baseline Approval mode")).toBeDefined();
  });

  it("commits canonical in-range numbers on blur", () => {
    const onChange = vi.fn();
    renderModal(onChange);
    const input = screen.getByLabelText("Baseline Temperature") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0.50" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("temperature", "0.5");
  });

  it("rejects non-numeric and out-of-range input without committing", () => {
    const onChange = vi.fn();
    renderModal(onChange);
    const input = screen.getByLabelText("Baseline Temperature") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("0");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders the unlimited toggle for allow_unlimited fields and commits the token", () => {
    const meta = metaWith();
    meta.baseline_fields = [
      {
        dimension: "max_steps",
        field: "max_steps",
        label: "Max steps",
        group: "pipeline",
        default: "10",
        options: [{ value: "5", label: "5 steps" }],
        input: "number",
        min: 1,
        max: 100000,
        step: 1,
        allow_unlimited: true,
      },
    ];
    const onChange = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <BaselineModal
          open
          onClose={() => {}}
          running={false}
          meta={meta}
          dimension="framework"
          baseline={{ max_steps: "10" } as never}
          onBaselineFieldChange={onChange}
          showPromptBanner={false}
          onDismissPromptBanner={() => {}}
        />
      </I18nProvider>,
    );
    const toggle = screen.getByRole("button", { name: "Unlimited" });
    expect((toggle as HTMLButtonElement).attributes.getNamedItem("aria-pressed")?.value).toBe("false");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith("max_steps", "unlimited");
  });

  it("turning unlimited off restores the previous number", () => {
    const meta = metaWith();
    meta.baseline_fields = [
      {
        dimension: "max_steps",
        field: "max_steps",
        label: "Max steps",
        group: "pipeline",
        default: "10",
        options: [{ value: "5", label: "5 steps" }],
        input: "number",
        min: 1,
        max: 100000,
        step: 1,
        allow_unlimited: true,
      },
    ];
    const onChange = vi.fn();
    const view = render(
      <I18nProvider initialLocale="en">
        <BaselineModal
          open
          onClose={() => {}}
          running={false}
          meta={meta}
          dimension="framework"
          baseline={{ max_steps: "unlimited" } as never}
          onBaselineFieldChange={onChange}
          showPromptBanner={false}
          onDismissPromptBanner={() => {}}
        />
      </I18nProvider>,
    );
    // Toggle back off while the modal shows the unlimited state: the last
    // committed number is unknown here, so the field default is restored.
    fireEvent.click(screen.getByRole("button", { name: "Unlimited" }));
    expect(onChange).toHaveBeenCalledWith("max_steps", "10");
    view.unmount();
  });

  it("keeps the dropdown for the locked comparison dimension", () => {
    render(
      <I18nProvider initialLocale="en">
        <BaselineModal
          open
          onClose={() => {}}
          running={false}
          meta={metaWith()}
          dimension="temperature"
          baseline={{} as never}
          onBaselineFieldChange={() => {}}
          showPromptBanner={false}
          onDismissPromptBanner={() => {}}
        />
      </I18nProvider>,
    );
    // Locked: no textbox for temperature (select trigger is a button).
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
