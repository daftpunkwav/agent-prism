// @vitest-environment jsdom
/**
 * @file baseline modal tests
 * @description Locks the baseline dialog: groups, numeric commits, unlimited toggle, locking, and dismissal.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ArenaMeta } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { BaselineModal } from "../src/app/arena/BaselineModal.js";

const META = {
  model_compare_ready: false,
  baseline_fields: [
    {
      field: "temperature",
      label: "Temperature",
      group: "decode",
      dimension: "temperature",
      input: "number",
      min: 0,
      max: 2,
      default: "0.7",
      allow_unlimited: false,
      options: [],
    },
    {
      field: "max_steps",
      label: "Max steps",
      group: "pipeline",
      dimension: "max_steps",
      input: "number",
      min: 1,
      max: 200,
      default: "24",
      allow_unlimited: true,
      options: [],
    },
    {
      field: "framework",
      label: "Framework",
      group: "pipeline",
      dimension: "framework",
      input: "select",
      default: "native",
      options: [
        { value: "native", label: "Native" },
        { value: "langchain", label: "LangChain" },
      ],
    },
  ],
} as unknown as ArenaMeta;

const en = () => getCatalog("en").arena.setup;

afterEach(cleanup);

function renderModal(overrides?: {
  open?: boolean;
  dimension?: "framework" | "prompt" | "model" | "temperature" | "max_steps";
  showPromptBanner?: boolean;
  baseline?: Record<string, string>;
}) {
  const onBaselineFieldChange = vi.fn();
  const onClose = vi.fn();
  const onDismissPromptBanner = vi.fn();
  const rendered = render(
    <I18nProvider initialLocale="en">
      <BaselineModal
        open={overrides?.open ?? true}
        onClose={onClose}
        running={false}
        meta={META}
        dimension={overrides?.dimension ?? "framework"}
        baseline={overrides?.baseline ?? {}}
        onBaselineFieldChange={onBaselineFieldChange}
        showPromptBanner={overrides?.showPromptBanner ?? false}
        onDismissPromptBanner={onDismissPromptBanner}
      />
    </I18nProvider>,
  );
  return { ...rendered, onBaselineFieldChange, onClose, onDismissPromptBanner };
}

describe("BaselineModal", () => {
  it("renders nothing when closed", () => {
    renderModal({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders grouped baseline fields with the locked comparison field marked", () => {
    const { container } = renderModal();
    expect(screen.getByRole("dialog", { name: en().baselineTitle })).toBeDefined();
    expect(screen.getByText("Framework" + en().lockedSuffix)).toBeDefined();
    const lockedLabel = container.querySelector('[data-locked="true"]');
    expect(lockedLabel?.getAttribute("title")).toBe(en().lockedFieldTitle);
    expect(screen.getByText(getCatalog("en").arena.group.pipeline)).toBeDefined();
    expect(screen.getByText(getCatalog("en").arena.group.decode)).toBeDefined();
  });

  it("commits a valid numeric edit canonically on blur", () => {
    const { onBaselineFieldChange } = renderModal();
    const input = screen.getByLabelText(en().baselineFieldAria.replace("{label}", "Temperature"));
    fireEvent.change(input, { target: { value: "1.50" } });
    fireEvent.blur(input);
    expect(onBaselineFieldChange).toHaveBeenCalledWith("temperature", "1.5");
  });

  it("rejects an out-of-range edit with an inline alert and no commit", () => {
    const { onBaselineFieldChange } = renderModal();
    const input = screen.getByLabelText(en().baselineFieldAria.replace("{label}", "Temperature"));
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert").textContent).toBe(
      en().baselineNumberInvalid.replace("{min}", "0").replace("{max}", "2"),
    );
    expect(onBaselineFieldChange).not.toHaveBeenCalled();
  });

  it("toggles max_steps to unlimited and back to the last numeric value", async () => {
    const { onBaselineFieldChange, rerender } = renderModal({ baseline: {} });
    const toggle = screen.getByRole("button", { name: en().baselineUnlimited });
    fireEvent.click(toggle);
    expect(onBaselineFieldChange).toHaveBeenLastCalledWith("max_steps", "unlimited");
    // The parent applies the override; the toggle now reads unlimited and restores
    // the committed number when pressed again.
    rerender(
      <I18nProvider initialLocale="en">
        <BaselineModal
          open
          onClose={vi.fn()}
          running={false}
          meta={META}
          dimension="framework"
          baseline={{ max_steps: "unlimited" }}
          onBaselineFieldChange={onBaselineFieldChange}
          showPromptBanner={false}
          onDismissPromptBanner={vi.fn()}
        />
      </I18nProvider>,
    );
    await screen.findByRole("button", { name: en().baselineUnlimited });
    fireEvent.click(screen.getByRole("button", { name: en().baselineUnlimited }));
    expect(onBaselineFieldChange).toHaveBeenLastCalledWith("max_steps", "24");
  });

  it("closes via the close button and the escape key", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: en().baselineCloseAria }));
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("surfaces the model-readiness banner only on the model dimension", () => {
    renderModal({ dimension: "model" });
    expect(screen.getByText(new RegExp(en().modelNotReadyPrefix))).toBeDefined();
    cleanup();
    renderModal({ dimension: "prompt", showPromptBanner: true });
    expect(screen.getByText(en().promptBanner)).toBeDefined();
    cleanup();
    renderModal({ dimension: "framework" });
    expect(screen.queryByText(new RegExp(en().modelNotReadyPrefix))).toBeNull();
  });

  it("hands the prompt-banner dismissal upward", () => {
    const { onDismissPromptBanner } = renderModal({ dimension: "prompt", showPromptBanner: true });
    fireEvent.click(screen.getByRole("button", { name: en().dismissBannerAria }));
    expect(onDismissPromptBanner).toHaveBeenCalledOnce();
  });
});
