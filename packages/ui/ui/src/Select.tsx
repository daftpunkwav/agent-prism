/**
 * @file Select
 * @description Themed dropdown select: a native-select replacement whose popup is
 * rendered through a portal so overflow-hidden ancestors never clip it.
 *
 * Responsibilities:
 * - Render a trigger button plus a keyboard-navigable listbox popup
 * - Support flat option lists and grouped option lists
 * - Keep every color/size decision in theme CSS variables
 *
 * The component owns no business vocabulary: labels come from the host, options are
 * plain data, and styling hooks live in global.css (.ui-select-*).
 */

"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

/** One selectable entry. */
export interface UiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** A labeled group of entries (renders a non-selectable caption row). */
export interface UiSelectGroup {
  group: string;
  options: UiSelectOption[];
}

export type UiSelectEntry = UiSelectOption | UiSelectGroup;

export interface UiSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: UiSelectEntry[];
  disabled?: boolean;
  /** Accessible name for trigger and popup (native selects always carried one here). */
  ariaLabel: string;
  /** Layout/size classes land on the relative wrapper; the trigger fills it. */
  className?: string;
  /** Optional leading node inside the trigger (e.g. the language glyph). */
  icon?: ReactNode;
  /** Static trigger caption; replaces the selected option's label when set
      (the popup still lists and highlights the real options). */
  triggerLabel?: string;
}

function isGroup(entry: UiSelectEntry): entry is UiSelectGroup {
  return (entry as UiSelectGroup).group !== undefined;
}

function flattenEntries(entries: UiSelectEntry[]): UiSelectOption[] {
  return entries.flatMap((entry) => (isGroup(entry) ? entry.options : [entry]));
}

/** Next selectable index stepping by `step` (wrapping); returns `from` when everything is disabled. */
function nextSelectableIndex(options: UiSelectOption[], from: number, step: 1 | -1): number {
  const length = options.length;
  if (length === 0) return from;
  for (let offset = 1; offset <= length; offset += 1) {
    const index = (((from + step * offset) % length) + length) % length;
    if (options[index]?.disabled !== true) return index;
  }
  return from;
}

/** Themed dropdown select with a portal popup: click-outside, scroll/resize dismiss, full arrow-key navigation. */
export function UiSelect({ value, onChange, options, disabled = false, ariaLabel, className, icon, triggerLabel }: UiSelectProps) {
  const flat = flattenEntries(options);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<DOMRect | null>(null);

  const openPopup = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    anchorRef.current = rect;
    const selectedIdx = flat.findIndex((option) => option.value === value);
    setActive(selectedIdx >= 0 ? selectedIdx : 0);
    setPos({ left: rect.left, top: rect.bottom + 4, width: rect.width });
    setOpen(true);
  }, [flat, value]);

  const closePopup = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // Dismiss on outside press, or on scrolls originating outside the popup: the popup is
  // fixed-positioned, so a scrolled anchor would leave it stranded. Scrolls inside the
  // popup itself (its own overflow) must not dismiss it, or long lists can never scroll.
  // Resize has no Node target (window) and always dismisses.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && popRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  // Flip above the trigger when the popup would run past the viewport bottom; clamp into view.
  useLayoutEffect(() => {
    if (!open || !pos || !popRef.current || !anchorRef.current) return;
    const pop = popRef.current;
    const popH = pop.offsetHeight;
    const popW = pop.offsetWidth;
    const rect = anchorRef.current;
    let left = pos.left;
    let top = pos.top;
    if (top + popH > window.innerHeight - 8) top = rect.top - popH - 4;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - 8 - popW;
    if (left < 8) left = 8;
    // Symmetric clamp for the flipped position: short viewports must not push
    // the popup above the viewport top edge.
    if (top < 8) top = 8;
    if (left !== pos.left || top !== pos.top) setPos({ left, top, width: pos.width });
    pop.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    popRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const commit = useCallback(
    (index: number) => {
      const option = flat[index];
      if (!option || option.disabled) return;
      onChange(option.value);
      closePopup(true);
    },
    [flat, onChange, closePopup],
  );

  const onPopupKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => nextSelectableIndex(flat, i, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => nextSelectableIndex(flat, i, -1));
    } else if (event.key === "Home") {
      event.preventDefault();
      // Land on the first selectable entry, never on a disabled one.
      const first = flat.findIndex((option) => option.disabled !== true);
      if (first >= 0) setActive(first);
    } else if (event.key === "End") {
      event.preventDefault();
      for (let index = flat.length - 1; index >= 0; index -= 1) {
        if (flat[index]?.disabled !== true) {
          setActive(index);
          break;
        }
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commit(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePopup(true);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const renderOption = (option: UiSelectOption, index: number) => (
    <button
      key={option.value}
      type="button"
      role="option"
      id={`${listboxId}-opt-${index}`}
      aria-selected={option.value === value}
      data-active={index === active || undefined}
      disabled={option.disabled}
      className="ui-select-item"
      onMouseEnter={() => setActive(index)}
      onClick={() => commit(index)}
    >
      <Check className="ui-select-item-check" aria-hidden />
      <span className="ui-select-item-label">{option.label}</span>
    </button>
  );

  let runningIndex = -1;
  return (
    <span className={"ui-select" + (className ? " " + className : "")}>
      <button
        type="button"
        ref={triggerRef}
        className="ui-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? closePopup() : openPopup())}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openPopup();
          }
        }}
      >
        {icon}
        <span className="ui-select-value">{triggerLabel ?? flat.find((option) => option.value === value)?.label ?? value}</span>
        <ChevronDown className={"ui-select-chevron" + (open ? " ui-select-chevron-open" : "")} aria-hidden />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            className="ui-select-pop"
            role="listbox"
            id={listboxId}
            aria-label={ariaLabel}
            aria-activedescendant={`${listboxId}-opt-${active}`}
            tabIndex={-1}
            style={{ left: pos.left, top: pos.top, minWidth: pos.width }}
            onKeyDown={onPopupKeyDown}
          >
            {options.map((entry) => {
              if (isGroup(entry)) {
                return (
                  <div key={`group:${entry.group}`} role="group" aria-label={entry.group}>
                    <p className="ui-select-group-label">{entry.group}</p>
                    {entry.options.map((option) => {
                      runningIndex += 1;
                      return renderOption(option, runningIndex);
                    })}
                  </div>
                );
              }
              runningIndex += 1;
              return renderOption(entry, runningIndex);
            })}
          </div>,
          document.body,
        )}
    </span>
  );
}
