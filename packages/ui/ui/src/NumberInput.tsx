/**
 * @file NumberInput
 * @description Blur-committed numeric input for the shared UI package.
 *
 * Responsibilities:
 * - Let users type freely (empty and partial states included): every keystroke
 *   only updates local text, so mid-edit content is never rewritten under the
 *   user — commit waits for the user to finish (blur or Enter), never a timer
 * - Validate on commit: a finite in-range number reports through onChange
 *   (integers truncate); empty, unparseable, or out-of-range text keeps the
 *   user's input visible, flags the field, and shows the caller's message
 *   (without a caller message the previous value is restored instead)
 * - Escape restores the last committed value; stay presentation-only: parsing
 *   rules live here, domain validation stays with the caller
 */

"use client";

import { useEffect, useRef, useState } from "react";

export interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  /** Inclusive lower bound; text outside the range is flagged, not committed. */
  min?: number;
  /** Inclusive upper bound; text outside the range is flagged, not committed. */
  max?: number;
  /** Truncate to an integer on commit (token counts, steps). */
  integer?: boolean;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Message shown under the field while the committed text is invalid (empty, unparseable, or out of range). */
  invalidMessage?: string;
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  integer = false,
  className,
  placeholder,
  ariaLabel,
  disabled,
  invalidMessage,
}: NumberInputProps) {
  const [text, setText] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  // commit() runs from blur, which Escape fires synchronously. setState from
  // the key handler has not rendered yet, so the text commit reads is this ref.
  const textRef = useRef(text);
  const valueRef = useRef(value);
  valueRef.current = value;

  const writeText = (next: string) => {
    textRef.current = next;
    setText(next);
  };

  // Sync on actual value changes only. A rejected edit leaves the external
  // value untouched, so this effect does not erase the text the user is fixing.
  useEffect(() => {
    writeText(String(value));
    setInvalid(false);
  }, [value]);

  const commit = () => {
    const current = valueRef.current;
    const trimmed = textRef.current.trim();
    const parsed = trimmed === "" ? NaN : Number(trimmed);
    if (Number.isFinite(parsed)) {
      const committed = integer ? Math.trunc(parsed) : parsed;
      const inRange = (min === undefined || committed >= min) && (max === undefined || committed <= max);
      if (inRange) {
        setInvalid(false);
        writeText(String(committed));
        if (committed !== current) onChange(committed);
        return;
      }
    }
    // Invalid edit: keep the user's text on screen (never silently rewrite it
    // to the previous value), flag the field, and surface the caller's message.
    if (invalidMessage !== undefined) setInvalid(true);
    else {
      writeText(String(current));
      setInvalid(false);
    }
  };

  return (
    <span className="block w-full">
      <input
        type="text"
        inputMode="decimal"
        className={className}
        value={text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onChange={(e) => {
          writeText(e.target.value);
          if (invalid) setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            // Write the ref before blur: commit reads the ref, sees the committed
            // value, and does not fire onChange.
            writeText(String(valueRef.current));
            setInvalid(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {invalid && invalidMessage !== undefined && (
        <p role="alert" className="text-[11px] leading-snug text-destructive">
          {invalidMessage}
        </p>
      )}
    </span>
  );
}
