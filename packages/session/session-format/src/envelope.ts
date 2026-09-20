/**
 * @file session-format/envelope
 * @description Versioned session document envelopes and filename rules.
 *
 * Responsibilities:
 * - Define the `{version, record, entries}` envelope shape per format version
 * - Map session ids to safe filenames (single segment, no traversal)
 * - Distinguish legacy (v1) from current (v2) documents for the migrator
 *
 * v1 documents carry `{record, entries}` without a version marker and without
 * the nullable-summary/metadata/entryCount fields; v2 adds `version: 2` plus
 * the full record shape. Unknown versions fail loudly in the migrator —
 * silently misreading a newer format is worse than refusing.
 */

/** Current envelope version written by this package. */
export const SESSION_ENVELOPE_VERSION = 2;

/** Legacy envelope version (unmarked documents). */
export const SESSION_ENVELOPE_V1 = 1;

/** Envelope filename suffix for session documents. */
export const SESSION_FILE_SUFFIX = ".session.json";

/** Max session id length accepted in filenames. */
export const SESSION_ID_MAX_LENGTH = 128;

/**
 * Maps a session id to a document filename (fail-closed on unsafe ids).
 * Ids must be non-empty path-safe single segments; traversal rejected.
 */
export function sessionFilename(id: string): string {
  if (id === "" || id.length > SESSION_ID_MAX_LENGTH) {
    throw new Error(`Invalid session id for filename: ${JSON.stringify(id.slice(0, 32))}`);
  }
  if (id.includes("/") || id.includes("\\") || id === "." || id === "..") {
    throw new Error(`Session id escapes filename scope: ${JSON.stringify(id.slice(0, 32))}`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error(`Session id has unsafe filename characters: ${JSON.stringify(id.slice(0, 32))}`);
  }
  return `${id}${SESSION_FILE_SUFFIX}`;
}

/** Detects the envelope version of an unknown document (null when unreadable). */
export function detectEnvelopeVersion(document: unknown): number | null {
  if (document === null || typeof document !== "object" || Array.isArray(document)) return null;
  const record = document as Record<string, unknown>;
  if (typeof record.version === "number" && Number.isInteger(record.version)) {
    return record.version as number;
  }
  if ("record" in record && "entries" in record) return SESSION_ENVELOPE_V1;
  return null;
}
