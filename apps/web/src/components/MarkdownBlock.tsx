/**
 * @file MarkdownBlock
 * @description Shared GFM markdown renderer for model text (arena trace + builder chat).
 *
 * Responsibilities:
 * - Render one markdown text block with the app's prose typography
 * - Memoize per text so settled blocks never re-parse while a sibling streams
 *
 * Presentation only: no state, no data fetching.
 */

"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown block memoized per text: completed segments never re-parse while a sibling streams. */
export const MarkdownBlock = memo(function MarkdownBlock({ text }: { text: string }) {
  return (
    // Typography comes from the custom .prose rules in global.css; the
    // @tailwindcss/typography variants are not installed and would be dead classes.
    <div className="prose max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
});
