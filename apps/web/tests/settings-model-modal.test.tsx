// @vitest-environment jsdom
/**
 * @file settings model modal tests
 * @description Locks the model add/edit dialog: id stability across save, the
 * set-default control only existing for persisted models, and Escape closing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { blankModel, type ModelSlot } from "../src/app/settings/settingsConnectionModel.js";
import { ModelModal } from "../src/app/settings/ModelModal.js";

function renderModal(overrides: Partial<Parameters<typeof ModelModal>[0]> = {}) {
  const initial: ModelSlot = { ...blankModel(), model: "saved-model", id: "ep_1" };
  const onSetDefault = vi.fn();
  const onClose = vi.fn();
  const onSave = vi.fn();
  const merged: Parameters<typeof ModelModal>[0] = {
    initial,
    isNew: false,
    apiFormat: "openai_chat",
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

describe("ModelModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the draft id through save and trims the model id", () => {
    const initial: ModelSlot = { ...blankModel(), id: "m_abc" };
    const { onSave } = renderModal({ initial, isNew: true });
    const input = screen.getByPlaceholderText("model id");
    fireEvent.change(input, { target: { value: "  gpt-x  " } });
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.model.modalSave }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]?.[0] as ModelSlot;
    // Regenerating the id at add time would dangle state keyed on the draft id.
    expect(saved.id).toBe("m_abc");
    expect(saved.model).toBe("gpt-x");
  });

  it("hides set-default for a new draft (a local id cannot become the persisted default)", () => {
    renderModal({ isNew: true });
    expect(screen.queryByRole("checkbox", { name: getCatalog("en").settings.model.setDefaultTitle })).toBeNull();
  });

  it("shows and wires set-default for an existing model", () => {
    const initial: ModelSlot = { ...blankModel(), model: "saved-model", id: "ep_1" };
    const { onSetDefault } = renderModal({ initial, defaultEndpointId: initial.id });
    const checkbox = screen.getByRole("checkbox", { name: getCatalog("en").settings.model.setDefaultTitle });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(checkbox);
    expect(onSetDefault).toHaveBeenCalledWith(initial.id);
  });

  it("Escape closes the dialog", () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
