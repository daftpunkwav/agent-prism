/**
 * @file QuestionSuggest
 * @description Suggested-question dropdown anchored to the composer input.
 *
 * Responsibilities:
 * - Render the suggestion listbox through a portal (immune to overflow clipping)
 * - Flip above the anchor when viewport space runs out
 * - Surface hover state; keyboard navigation lives with the input in ComposerBar
 */

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";

export interface SuggestItem {
  /** Template id; empty for free-form suggestions without a judge. */
  id: string;
  name: string;
  question: string;
}

export interface QuestionSuggestProps {
  anchorRef: React.RefObject<HTMLInputElement | null>;
  items: SuggestItem[];
  activeIndex: number;
  ariaLabel: string;
  onPick: (item: SuggestItem) => void;
  onHover: (index: number) => void;
  onClose: () => void;
}

/** Portal suggestion listbox anchored to the composer input. */
export function QuestionSuggest({ anchorRef, items, activeIndex, ariaLabel, onPick, onHover, onClose }: QuestionSuggestProps) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const anchorRectRef = useRef<DOMRect | null>(null);

  // Recompute the anchor geometry whenever the item list changes (open / query edits).
  useEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    anchorRectRef.current = rect;
    setPos({ left: rect.left, top: rect.bottom + 4, width: rect.width });
  }, [items, anchorRef]);

  // Flip above the anchor when the list would run past the viewport bottom.
  useLayoutEffect(() => {
    if (!pos || !popRef.current || !anchorRectRef.current) return;
    const popH = popRef.current.offsetHeight;
    const popW = popRef.current.offsetWidth;
    const rect = anchorRectRef.current;
    let { left, top } = pos;
    if (top + popH > window.innerHeight - 8) top = rect.top - popH - 4;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - 8 - popW;
    if (left < 8) left = 8;
    if (left !== pos.left || top !== pos.top) setPos({ left, top, width: pos.width });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  // Dismiss on outside pointer press, any scroll, or resize (fixed positioning drifts).
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, anchorRef]);

  if (pos === null || items.length === 0) return null;

  return createPortal(
    <div ref={popRef} className="composer-suggest" role="listbox" aria-label={ariaLabel} style={{ left: pos.left, top: pos.top, minWidth: pos.width }}>
      {items.map((item, index) => (
        <button
          key={item.id === "" ? `q:${item.question}` : item.id}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className="composer-suggest-item"
          data-active={index === activeIndex || undefined}
          onMouseDown={(event) => {
            // Pick before the input's blur handler closes the list.
            event.preventDefault();
            onPick(item);
          }}
          onMouseEnter={() => onHover(index)}
          onClick={() => onPick(item)}
        >
          <Sparkles className="composer-suggest-icon" aria-hidden />
          <span className="composer-suggest-text">
            <span className="composer-suggest-question">{item.question}</span>
            <span className="composer-suggest-name">{item.name}</span>
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
