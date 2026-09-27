// @vitest-environment jsdom
/**
 * @file settings model modal tests
 * @description Locks the model add/edit dialog: draft handling, the save gate,
 * the set-default control, the thinking cluster, and dialog keyboard behavior.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { blankModel, type ModelSlot } from "../src/app/settings/settingsConnectionModel.js";
import { ModelModal } from "../src/app/settings/ModelModal.js";

const en = () => getCatalog("en").settings.model;

function renderModal(overrides: Partial<Parameters<typeof ModelModal>[0]> = {}) {
  const initial: ModelSlot = { ...blankModel(), model: "saved-model", id: "ep_1" };
  const onSetDefault = vi.fn();
  const onClose = vi.fn();
  const onSave = vi.fn();
  const merged: Parameters<typeof ModelModal>[0] = {
    initial,
    isNew: false,
    defaultEndpointId: "",
    onSetDefault,
    onClose,
    onSave,
    ...overrides,
  };
  render(
    <I18nProvider initialLocale="en">
      <ModelModal {...merged} />
    </I18nProvider>,
  );
  return { initial, onSetDefault, onClose, onSave };
}

const saveButton = () => screen.getByRole("button", { name: en().modalSave }) as HTMLButtonElement;
const thinkingToggle = () => screen.getByRole("checkbox", { name: en().thinkingCapable }) as HTMLInputElement;

// jsdom ships no scrollIntoView, and the select popup scrolls its active row into
// view when it opens.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
});

describe("ModelModal draft handling", () => {
  it("keeps the draft id through save and trims the model id", () => {
    const initial: ModelSlot = { ...blankModel(), id: "m_abc" };
    const { onSave } = renderModal({ initial, isNew: true });
    const input = screen.getByPlaceholderText("model id");
    fireEvent.change(input, { target: { value: "  gpt-x  " } });
    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]?.[0] as ModelSlot;
    // Regenerating the id at add time would dangle state keyed on the draft id.
    expect(saved.id).toBe("m_abc");
    expect(saved.model).toBe("gpt-x");
  });

  it("trims the label and leaves the saved draft otherwise untouched", () => {
    const { onSave } = renderModal();
    fireEvent.change(screen.getByPlaceholderText(en().labelPlaceholder), { target: { value: "  Fast model  " } });
    fireEvent.click(saveButton());
    const saved = onSave.mock.calls[0]?.[0] as ModelSlot;
    expect(saved.label).toBe("Fast model");
    expect(saved.model).toBe("saved-model");
  });

  it("discards edits on close: nothing reaches the parent until Save", () => {
    const { onSave, onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText("model id"), { target: { value: "edited" } });
    fireEvent.click(screen.getByRole("button", { name: en().modalCancel }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks save while the model id is blank, and re-enables it when filled", () => {
    renderModal({ isNew: true, initial: { ...blankModel(), model: "" } });
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("model id"), { target: { value: "gpt-y" } });
    expect(saveButton().disabled).toBe(false);
    // Whitespace-only ids are blank after the trim the gate applies.
    fireEvent.change(screen.getByPlaceholderText("model id"), { target: { value: "   " } });
    expect(saveButton().disabled).toBe(true);
  });

  it("closes when the backdrop is clicked", () => {
    const { onClose } = renderModal();
    // The backdrop shares its aria-label with the header close button.
    const backdrop = document.querySelector(".arena-modal-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ModelModal set-default control", () => {
  it("hides set-default for a new draft (a local id cannot become the persisted default)", () => {
    renderModal({ isNew: true });
    expect(screen.queryByRole("checkbox", { name: en().setDefaultTitle })).toBeNull();
  });

  it("shows and wires set-default for an existing model", () => {
    const initial: ModelSlot = { ...blankModel(), model: "saved-model", id: "ep_1" };
    const { onSetDefault } = renderModal({ initial, defaultEndpointId: initial.id });
    const checkbox = screen.getByRole("checkbox", { name: en().setDefaultTitle });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(checkbox);
    expect(onSetDefault).toHaveBeenCalledWith(initial.id);
  });
});

describe("ModelModal thinking cluster", () => {
  it("keeps the level control disabled and the budget pair hidden until thinking is on", () => {
    renderModal();
    expect(thinkingToggle().checked).toBe(false);
    expect(screen.queryByText(en().thinkingBudgetTokens)).toBeNull();

    fireEvent.click(thinkingToggle());
    expect(screen.getByText(en().thinkingBudgetTokens)).toBeTruthy();
    expect(screen.getByText(en().thinkingOutputTokens)).toBeTruthy();
  });

  it("raises the level to a usable default when capability is picked", () => {
    const { onSave } = renderModal();
    fireEvent.click(thinkingToggle());
    // "medium" exists in the standard option set, so that is the first pick.
    fireEvent.click(saveButton());
    expect((onSave.mock.calls[0]?.[0] as ModelSlot).thinking_level).toBe("medium");
  });

  it("clearing the capability resets the level to off", () => {
    const { onSave } = renderModal();
    fireEvent.click(thinkingToggle());
    fireEvent.click(thinkingToggle());
    fireEvent.click(saveButton());
    expect((onSave.mock.calls[0]?.[0] as ModelSlot).thinking_level).toBe("off");
  });

  it("drops the level to off when the capability is cleared even if a vendor level was chosen", () => {
    const initial: ModelSlot = { ...blankModel(), model: "m", thinking_capable: true, thinking_level: "adaptive", thinking_levels: ["adaptive"] };
    const { onSave } = renderModal({ initial });
    fireEvent.click(thinkingToggle());
    fireEvent.click(saveButton());
    expect((onSave.mock.calls[0]?.[0] as ModelSlot).thinking_level).toBe("off");
  });

  it("flags an output budget that does not exceed the thinking budget and blocks save", () => {
    const initial: ModelSlot = {
      ...blankModel(),
      model: "m",
      thinking_capable: true,
      thinking_level: "low",
      thinking_budget_tokens: 4096,
      thinking_max_tokens: 4096,
    };
    renderModal({ initial });
    expect(screen.getByText(en().thinkingBudgetError)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it("accepts an output budget above the thinking budget", () => {
    const initial: ModelSlot = {
      ...blankModel(),
      model: "m",
      thinking_capable: true,
      thinking_level: "low",
      thinking_budget_tokens: 4096,
      thinking_max_tokens: 8192,
    };
    const { onSave } = renderModal({ initial });
    expect(screen.queryByText(en().thinkingBudgetError)).toBeNull();
    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("uses vendor-defined levels in place of the standard set", () => {
    const initial: ModelSlot = { ...blankModel(), model: "m", thinking_capable: true, thinking_levels: ["adaptive"] };
    renderModal({ initial });
    fireEvent.click(screen.getByRole("button", { name: en().defaultThinkingLevel }));
    const options = screen.getAllByRole("option");
    // The vendor list is offered as-is, with "off" always available; the standard
    // named levels are gone.
    expect(options.map((option) => option.textContent)).toEqual(["Off", "adaptive"]);
  });

  it("adds, edits, and removes custom levels, and keeps the selected one", () => {
    const initial: ModelSlot = { ...blankModel(), model: "m", thinking_capable: true, thinking_level: "fast", thinking_levels: ["fast"] };
    const { onSave } = renderModal({ initial });

    // Add a row and type a second level; the current choice stays selected.
    fireEvent.click(screen.getByRole("button", { name: en().customLevelAdd }));
    fireEvent.change(screen.getByLabelText(en().customLevelAria.replace("{index}", "2")), { target: { value: "slow" } });
    expect(screen.getByRole("button", { name: en().defaultThinkingLevel }).textContent).toContain("fast");

    // Removing the selected row drops the choice to off: keeping a value the vendor
    // list no longer offers would leave the control showing an unselectable level.
    fireEvent.click(screen.getByRole("button", { name: en().customLevelRemoveAria.replace("{index}", "1") }));
    expect(screen.getByRole("button", { name: en().defaultThinkingLevel }).textContent).toContain("Off");

    fireEvent.click(saveButton());
    const saved = onSave.mock.calls[0]?.[0] as ModelSlot;
    expect(saved.thinking_levels).toEqual(["slow"]);
    expect(saved.thinking_level).toBe("off");
  });

  it("caps the custom-level list at sixteen rows", () => {
    const initial: ModelSlot = {
      ...blankModel(),
      model: "m",
      thinking_capable: true,
      thinking_levels: Array.from({ length: 16 }, (_v, i) => `level-${i}`),
    };
    renderModal({ initial });
    expect((screen.getByRole("button", { name: en().customLevelAdd }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("trims and de-duplicates custom levels on save", () => {
    const initial: ModelSlot = {
      ...blankModel(),
      model: "m",
      thinking_capable: true,
      thinking_level: "slow",
      thinking_levels: [" slow ", "fast", "slow"],
    };
    const { onSave } = renderModal({ initial });
    fireEvent.click(saveButton());
    const saved = onSave.mock.calls[0]?.[0] as ModelSlot;
    expect(saved.thinking_levels).toEqual(["slow", "fast"]);
    expect(saved.thinking_level).toBe("slow");
  });

  it("falls back to off when the selected level is not one of the saved levels", () => {
    const initial: ModelSlot = {
      ...blankModel(),
      model: "m",
      thinking_capable: true,
      thinking_level: "ghost",
      thinking_levels: ["fast"],
    };
    const { onSave } = renderModal({ initial });
    fireEvent.click(saveButton());
    // "ghost" is not offered by the saved level list, so the selection cannot survive.
    expect((onSave.mock.calls[0]?.[0] as ModelSlot).thinking_level).toBe("off");
  });
});

describe("ModelModal dialog keyboard behavior", () => {
  it("Escape closes the dialog", () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Tab inside the dialog: forward from the last control wraps to the first", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    const focusables = dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();

    last?.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("wraps backward from the first control to the last, and leaves Shift+Tab elsewhere alone", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    const focusables = dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    first?.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    // Shift+Tab in the middle of the dialog stays with the browser's own order.
    const middle = focusables[2];
    middle?.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(middle);
  });

  it("focuses the dialog on open", () => {
    renderModal();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });
});
