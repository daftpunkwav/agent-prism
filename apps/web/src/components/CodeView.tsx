/**
 * @file CodeView
 * @description Read-only syntax-highlighted source view for workspace file previews.
 *
 * Responsibilities:
 * - Render tokenized source text with comment/string/number/keyword colors
 * - Memoize per file+content so re-polls never re-tokenize settled files
 *
 * Presentation only: tokenization is pure (components/codeHighlight) and the
 * colors come from CSS classes, never inline styles.
 */

"use client";

import { memo } from "react";
import { languageOfPath, tokenizeCode } from "./codeHighlight";

/** Read-only highlighted source view; falls back to plain text for unknown extensions. */
export const CodeView = memo(function CodeView({ path, content }: { path: string; content: string }) {
  const language = languageOfPath(path);
  const tokens = tokenizeCode(content, language);
  return (
    <pre className="code-view flex-1 p-3 text-xs font-mono overflow-auto whitespace-pre-wrap break-words" data-lang={language || undefined}>
      <code>
        {tokens.map((token, index) =>
          token.kind === null ? (
            token.text
          ) : (
            <span key={index} className={`hl-${token.kind}`}>
              {token.text}
            </span>
          ),
        )}
      </code>
    </pre>
  );
});
