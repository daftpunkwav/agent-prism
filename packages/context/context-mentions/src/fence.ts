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

/** Escapes regular-expression metacharacters so a tag name can be embedded literally. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Neutralizes closing-tag lookalikes inside text mounted in a fenced prompt block.
 *
 * Models do not parse markup case-sensitively: `</TAG>`, `</tag >`, and
 * `</tag attr="x">` all read as the block close, so an exact-match replace is not
 * enough to keep workspace content from ending its own frame. Inserting a backslash
 * after "<" keeps the text readable while it can no longer match the close tag.
 *
 * @param text Content rendered inside the fence (may be empty).
 * @param tag Tag name of the fence; must end with a word character for the `\b`
 *   boundary to behave.
 * @returns `text` with every closing-tag variant escaped.
 */
export function escapeClosingTag(text: string, tag: string): string {
  if (text === "" || tag === "") return text;
  // <\/\s*TAG\b[^>]*>  →  <\/TAG...> for every case/whitespace/attribute variant.
  const pattern = new RegExp(`<\\/\\s*${escapeRegExp(tag)}\\b[^>]*>`, "gi");
  return text.replace(pattern, (match) => "<\\" + match.slice(1));
}
