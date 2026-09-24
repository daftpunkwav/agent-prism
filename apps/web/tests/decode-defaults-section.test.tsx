// @vitest-environment jsdom
/**
 * @file decode defaults section tests
 * @description Locks the settings decode-defaults form: range binding and change handoff.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DECODE_FIELD_RANGES } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import type { SettingsForm } from "../src/app/settings/settingsConnectionModel.js";
import { DecodeDefaultsSection } from "../src/app/settings/DecodeDefaultsSection.js";

const FORM = {
  notes: "",
  connections: [],
  default_endpoint_id: "",
  temperature: 0.7,
  top_p: 0.9,
  frequency_penalty: 0,
  presence_penalty: 0,
  max_output_tokens: 4096,
} as SettingsForm;

afterEach(cleanup);

function renderSection(onChange = vi.fn()) {
  render(
    <I18nProvider initialLocale="en">
      <DecodeDefaultsSection form={FORM} onChange={onChange} />
    </I18nProvider>,
  );
  return onChange;
}

describe("DecodeDefaultsSection", () => {
  it("shows the loaded values", () => {
    renderSection();
    const maxOutput = screen.getByLabelText(getCatalog("en").settings.decode.maxOutput) as HTMLInputElement;
    expect(maxOutput.value).toBe("4096");
  });

  it("hands numeric patches to the form on blur", () => {
    const onChange = renderSection();
    const temperature = screen.getByLabelText("Temperature");
    fireEvent.focus(temperature);
    fireEvent.change(temperature, { target: { value: "1.5" } });
    fireEvent.blur(temperature);
    expect(onChange).toHaveBeenCalledWith({ temperature: 1.5 });
    const topP = screen.getByLabelText("Top P");
    fireEvent.focus(topP);
    fireEvent.change(topP, { target: { value: "0.3" } });
    fireEvent.blur(topP);
    expect(onChange).toHaveBeenCalledWith({ top_p: 0.3 });
  });

  it("edits the free-form notes behind the collapsed details", () => {
    const onChange = renderSection();
    fireEvent.click(screen.getByText(getCatalog("en").settings.decode.notes));
    const notes = document.querySelector(
      'input[placeholder="' + getCatalog("en").settings.decode.notesPlaceholder + '"]',
    ) as HTMLInputElement;
    expect(notes.value).toBe("");
    fireEvent.change(notes, { target: { value: "keep answers terse" } });
    expect(onChange).toHaveBeenCalledWith({ notes: "keep answers terse" });
  });
});
