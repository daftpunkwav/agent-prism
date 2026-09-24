/**
 * @file NumberInput
 * @description Debounced numeric input for the shared UI package.
 *
 * Responsibilities:
 * - Let users type freely (empty and partial states included) without the
 *   controlled-value "stuck zero" problem
 * - Commit the parsed number after the typing pauses (debounce) or on blur,
 *   clamped to [min, max] when provided
 * - Stay presentation-only: parsing/rounding rules live here, domain
 *   validation stays with the caller
 */

"use client";

import { useEffect, useRef, useState } from "react";

const COMMIT_DEBOUNCE_MS = 500;

export interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  /** Inclusive lower bound applied on commit. */
  min?: number;
  /** Inclusive upper bound applied on commit. */
  max?: number;
  /** Truncate to an integer on commit (token counts, steps). */
  integer?: boolean;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

/** Result of validating free text: a clamped number, or "revert" for empty/unparseable input. */
interface CommitResult {
  committed: number;
  revert: boolean;
}

/** Empty or unparseable text reverts to the current value; finite text clamps to [min, max]. */
function parseCommitted(
  text: string,
  fallback: number,
  min: number | undefined,
  max: number | undefined,
  integer: boolean,
): CommitResult {
  const trimmed = text.trim();
  if (trimmed === "") return { committed: fallback, revert: true };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return { committed: fallback, revert: true };
  let value = parsed;
  if (integer) value = Math.trunc(value);
  if (min !== undefined) value = Math.max(min, value);
  if (max !== undefined) value = Math.min(max, value);
  return { committed: value, revert: false };
}

/**
 * Numeric input with idle-commit semantics: every keystroke only updates local
 * text; once typing pauses (COMMIT_DEBOUNCE_MS) or the field blurs, the text
 * is parsed, clamped, and reported through onChange.
 */
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
}: NumberInputProps) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // External value changes (reset, saved reload) win whenever the user is not
  // mid-edit; during editing the free text stays untouched.
  useEffect(() => {
    if (!editing) setText(String(value));
  }, [value, editing]);

  // A pending debounce must not fire onChange after unmount (e.g. a modal was
  // cancelled right after typing): the commit would resurrect discarded text.
  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const commit = (raw: string) => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const { committed, revert } = parseCommitted(raw, value, min, max, integer);
    setText(String(committed));
    if (!revert && committed !== value) onChange(committed);
  };

  const schedule = (raw: string) => {
    setText(raw);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(raw), COMMIT_DEBOUNCE_MS);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(e) => schedule(e.target.value)}
      onBlur={() => {
        setEditing(false);
        commit(text);
      }}
      onFocus={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
