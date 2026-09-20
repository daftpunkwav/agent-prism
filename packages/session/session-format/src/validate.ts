/**
 * @file session-format/validate
 * @description Structural validation of session documents with a loud taxonomy.
 *
 * Responsibilities:
 * - Validate v2 documents field by field (record, entries, seq density)
 * - Report every defect in one pass (error list, not first-failure)
 * - Stay pure: no IO, no migration, no repair
 *
 * Validation runs on read paths (import, restore, forensics) so corrupt
 * documents surface with actionable defect lists instead of downstream
 * undefined behavior. Seq density (0..n-1 per session) is checked because
 * sparse seqs indicate lost or duplicated milestones.
 */

import { detectEnvelopeVersion, SESSION_ENVELOPE_VERSION } from "./envelope.js";

/** One structural defect with a stable code. */
export interface SessionDefect {
  code: "version" | "record" | "entries" | "seq" | "content";
  message: string;
}

/** Validation verdict: valid documents carry zero defects. */
export interface SessionValidation {
  valid: boolean;
  defects: SessionDefect[];
}

const STATUSES = new Set(["active", "completed", "failed", "cancelled"]);
const KINDS = new Set(["arena", "agent", "builder"]);
const ENTRY_KINDS = new Set(["lifecycle", "verdict", "note"]);

/** Validates a v2-shaped document, collecting every defect. */
export function validateSessionDocument(document: unknown): SessionValidation {
  const defects: SessionDefect[] = [];
  const fail = (code: SessionDefect["code"], message: string): void => {
    defects.push({ code, message });
  };
  const version = detectEnvelopeVersion(document);
  if (version !== SESSION_ENVELOPE_VERSION) {
    fail("version", `expected envelope version ${SESSION_ENVELOPE_VERSION}, got ${String(version)}`);
    return { valid: false, defects };
  }
  const record = (document as Record<string, unknown>).record as Record<string, unknown>;
  const entries = (document as Record<string, unknown>).entries as unknown;
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    fail("record", "record must be an object");
    return { valid: false, defects };
  }
  if (typeof record.id !== "string" || record.id === "") fail("record", "record.id must be a non-empty string");
  if (!KINDS.has(record.kind as string)) fail("record", `record.kind must be one of arena/agent/builder`);
  if (typeof record.title !== "string" || record.title.trim() === "") fail("record", "record.title must be non-blank");
  if (!STATUSES.has(record.status as string)) fail("record", "record.status must be a lifecycle status");
  if (typeof record.createdAt !== "number" || typeof record.updatedAt !== "number") {
    fail("record", "record.createdAt/updatedAt must be numbers");
  }
  if (record.summary !== null && typeof record.summary !== "string") fail("record", "record.summary must be string or null");
  if (!Array.isArray(entries)) {
    fail("entries", "entries must be an array");
    return { valid: defects.length === 0, defects };
  }
  const seen = new Set<number>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as Record<string, unknown>;
    if (entry === null || typeof entry !== "object") {
      fail("entries", `entry ${index} must be an object`);
      continue;
    }
    if (typeof entry.seq !== "number" || !Number.isInteger(entry.seq) || (entry.seq as number) < 0) {
      fail("seq", `entry ${index} has a non-integer seq`);
      continue;
    }
    if (seen.has(entry.seq as number)) fail("seq", `duplicate seq ${String(entry.seq)}`);
    seen.add(entry.seq as number);
    if (!ENTRY_KINDS.has(entry.kind as string)) fail("entries", `entry ${index} has an unknown kind`);
    if (typeof entry.content !== "string") fail("content", `entry ${index} content must be a string`);
    if (typeof entry.at !== "number") fail("entries", `entry ${index} at must be a number`);
  }
  for (let seq = 0; seq < entries.length; seq += 1) {
    if (!seen.has(seq)) fail("seq", `missing seq ${seq} (sparse entry sequence)`);
  }
  return { valid: defects.length === 0, defects };
}
