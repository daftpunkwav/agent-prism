// @vitest-environment jsdom
/**
 * @file model card tests
 * @description Locks the model slot editor: collapse, field handoff, thinking toggle, and delete guard.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import type { ModelSlot } from "../src/app/settings/settingsConnectionModel.js";
import { ModelCard } from "../src/app/settings/ModelCard.js";

const MODEL = {
  label: "Main",
  model: "glm-5.3",
  thinking_level: "off",
  thinking_capable: false,
  context_window: 128000,
  max_input_tokens: 120000,
  max_output_tokens: 32000,
  image_input: false,
  video_input: false,
} as unknown as ModelSlot;

function renderCard(overrides?: { expanded?: boolean; isDefault?: boolean; canDelete?: boolean; model?: Partial<ModelSlot> }) {
  const onToggleExpand = vi.fn();
  const onUpdate = vi.fn();
  const onSetDefault = vi.fn();
  const onDelete = vi.fn();
  render(
    <I18nProvider initialLocale="en">
      <ModelCard
        model={{ ...MODEL, ...overrides?.model } as ModelSlot}
        index={0}
        isDefault={overrides?.isDefault ?? false}
        expanded={overrides?.expanded ?? false}
        canDelete={overrides?.canDelete ?? true}
        onToggleExpand={onToggleExpand}
        onUpdate={onUpdate}
        onSetDefault={onSetDefault}
        onDelete={onDelete}
      />
    </I18nProvider>,
  );
  return { onToggleExpand, onUpdate, onSetDefault, onDelete };
}

const en = () => getCatalog("en").settings.model;

afterEach(cleanup);

describe("ModelCard", () => {
  it("toggles expansion through the collapse button", () => {
    const { onToggleExpand } = renderCard({ expanded: false });
    fireEvent.click(screen.getByRole("button", { name: en().expandAria }));
    expect(onToggleExpand).toHaveBeenCalledOnce();
  });

  it("edits label and model id inputs in the collapsed header", () => {
    const { onUpdate } = renderCard({ expanded: false });
    fireEvent.change(screen.getByLabelText(en().labelAria.replace("{index}", "1")), { target: { value: "Backup" } });
    expect(onUpdate).toHaveBeenCalledWith({ label: "Backup" });
    fireEvent.change(screen.getByLabelText(en().modelIdAria.replace("{index}", "1")), { target: { value: "glm-4.7" } });
    expect(onUpdate).toHaveBeenCalledWith({ model: "glm-4.7" });
  });

  it("shows the no-thinking badge and hides the param grid while collapsed", () => {
    renderCard({ expanded: false });
    expect(screen.getByText(en().noThinking)).toBeDefined();
    expect(screen.queryByLabelText(en().contextWindow)).toBeNull();
  });

  it("edits the param grid and checkboxes while expanded", () => {
    const { onUpdate } = renderCard({ expanded: true });
    fireEvent.change(screen.getByLabelText(en().contextWindow), { target: { value: "64000" } });
    expect(onUpdate).toHaveBeenCalledWith({ context_window: 64000 });
    fireEvent.click(screen.getByLabelText(en().imageInput));
    expect(onUpdate).toHaveBeenLastCalledWith({ image_input: true });
  });

  it("turning thinking on lifts a disabled level to medium", () => {
    const { onUpdate } = renderCard({ expanded: true });
    fireEvent.click(screen.getByLabelText(en().thinkingCapable));
    expect(onUpdate).toHaveBeenCalledWith({ thinking_capable: true, thinking_level: "medium" });
  });

  it("keeps an existing level when re-enabling thinking", () => {
    const { onUpdate } = renderCard({ expanded: true, model: { thinking_capable: false, thinking_level: "high" } });
    fireEvent.click(screen.getByLabelText(en().thinkingCapable));
    expect(onUpdate).toHaveBeenCalledWith({ thinking_capable: true, thinking_level: "high" });
  });

  it("marks the default with a pressed star and guards the delete button", () => {
    const { onDelete, onSetDefault } = renderCard({ isDefault: true, canDelete: false });
    expect(screen.getByRole("button", { name: en().setDefaultTitle }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: en().setDefaultTitle }));
    expect(onSetDefault).toHaveBeenCalledOnce();
    const del = screen.getByRole("button", { name: en().deleteAria }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    fireEvent.click(del);
    expect(onDelete).not.toHaveBeenCalled();
  });
});
