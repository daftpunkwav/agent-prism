/**
 * @file CopyButton
 * @description Tiny clipboard button shared by Arena report / diff raw-log blocks.
 *
 * Responsibilities:
 * - Copy text via navigator.clipboard with a transient copied state
 */

"use client";

import { useState } from "react";
import { useT } from "@/i18n/useT";

/** Copies text on click; shows a transient confirmation label. */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="chip-toggle !h-6 !px-2 text-[11px]"
      onClick={(event) => {
        // Inside a <summary>: don't toggle the parent <details> when copying.
        event.preventDefault();
        event.stopPropagation();
        try {
          void navigator.clipboard.writeText(text).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            },
            () => undefined,
          );
        } catch {
          // Clipboard unavailable (non-secure context): silent no-op, never blocks the view.
        }
      }}
    >
      {copied ? t("builder.copied") : (label ?? t("builder.copy"))}
    </button>
  );
}
