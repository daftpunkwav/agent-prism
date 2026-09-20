/**
 * @file workspace-name
 * @description Single source for workspace-name segment validation.
 *
 * Responsibilities:
 * - Decide which client-supplied names may address a workspace directory
 *
 * Shared by the agent layer (follow-up reuse gate) and the runtime layer
 * (restart rehydration guard) so the two never drift on the same invariant.
 * Length ceiling matches the longest generated name (85 chars, see agent run-workspace).
 */

/**
 * Whether a name is a single path-safe segment: Unicode letters/digits/dot/
 * underscore/hyphen only, 1-96 chars, never a bare dot traversal (".", "..")
 * or containing path separators. Stricter than truthy: "." alone is rejected.
 */
export function isSafeWorkspaceSegment(name: string): boolean {
  if (typeof name !== "string" || name.length < 1 || name.length > 96) return false;
  if (name === "." || name === ".." || name.includes("..") || name.includes("/") || name.includes("\\")) return false;
  return /^[\p{L}\p{N}._-]+$/u.test(name);
}

/**
 * Disk-safe file stem for a pipeline label (labels are unique within a run).
 * Unsafe characters collapse to `_`; a label with no safe characters left falls
 * back to a content hash so colliding columns can never share a file. Single
 * source for writers (run log appends) and readers (log lookup route) so the
 * two never drift on the on-disk name.
 */
export function safeLogStem(label: string): string {
  const cleaned = label.replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^_+|_+$/g, "");
  if (cleaned !== "" && cleaned !== "." && isSafeWorkspaceSegment(cleaned)) return cleaned;
  // FNV-1a (no crypto dependency in this layer): collision-safe enough for a
  // per-run directory where labels are already unique.
  let hash = 0x811c9dc5;
  for (let i = 0; i < label.length; i += 1) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `column_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
