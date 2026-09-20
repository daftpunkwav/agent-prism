/**
 * @file LanguageToggle
 * @description Locale switcher for the shared UI package.
 *
 * Responsibilities:
 * - Delegate the dropdown to UiSelect (themed popup, keyboard navigation)
 * - Blend the trigger into the header chip styling
 * - Surface only host-injected options, value, and labels
 *
 * Locale-free by design: the component never knows which locales exist, so a
 * third language needs no change here.
 */

"use client";

import { Languages } from "lucide-react";
import { UiSelect } from "./Select.js";

export type LanguageOption = {
  /** Canonical locale value passed back to onChange (host-normalized). */
  value: string;
  /** The language's own name, shown in the dropdown (e.g. "English", "Chinese"). */
  nativeLabel: string;
};

/** Locale switcher dropdown: host-injected options and labels, selection reported via onChange. */
export function LanguageToggle({
  locale,
  options,
  onChange,
  ariaLabel,
}: {
  locale: string;
  options: readonly LanguageOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <span className="lang-toggle">
      <UiSelect
        className="lang-toggle-select"
        value={locale}
        onChange={onChange}
        ariaLabel={ariaLabel}
        icon={<Languages className="lang-toggle-icon" aria-hidden />}
        options={options.map((option) => ({ value: option.value, label: option.nativeLabel }))}
      />
    </span>
  );
}
