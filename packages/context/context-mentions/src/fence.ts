/**
 * @file context-mentions/fence
 * @description Closing-tag escaping for fenced model-visible context blocks.
 *
 * Responsibilities:
 * - Neutralize a closing tag inside fenced content (case, whitespace, attributes)
 *
 * Dependency-free by design: this package sits below the harness layer and the
 * helper is shared by the mention, RAG-snippet, and workspace-instruction fences.
 */

/** Fence tags rendered by the shared prompt blocks. */
export type FenceTag = "workspace_instructions" | "retrieved_doc" | "file_mention";

/**
 * Literal patterns, one per known fence tag. Literals (never a tag-derived
 * `RegExp`) keep the helper free of pattern injection; models do not parse markup
 * case-sensitively, so case, whitespace, and attributes are all matched.
 */
const CLOSE_TAG_PATTERNS: Record<FenceTag, RegExp> = {
  workspace_instructions: /<\/\s*workspace_instructions\b[^>]*>/gi,
  retrieved_doc: /<\/\s*retrieved_doc\b[^>]*>/gi,
  file_mention: /<\/\s*file_mention\b[^>]*>/gi,
};

/**
 * Neutralizes closing-tag lookalikes inside text mounted in a fenced prompt block.
 *
 * Models do not parse markup case-sensitively: `</TAG>`, `</tag >`, and
 * `</tag attr="x">` all read as the block close, so an exact-match replace is not
 * enough to keep workspace content from ending its own frame. Inserting a backslash
 * after "<" keeps the text readable while it can no longer match the close tag.
 *
 * @param text Content rendered inside the fence (may be empty).
 * @param tag Fence tag known to the renderers.
 * @returns `text` with every closing-tag variant escaped.
 */
export function escapeClosingTag(text: string, tag: FenceTag): string {
  if (text === "") return text;
  // Literal global patterns: String#replace resets lastIndex before scanning.
  return text.replace(CLOSE_TAG_PATTERNS[tag], (match) => "<\\" + match.slice(1));
}
