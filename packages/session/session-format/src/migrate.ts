/**
 * @file session-format/migrate
 * @description v1 → v2 session document migration with backfill defaults.
 *
 * Responsibilities:
 * - Upgrade legacy documents to the current envelope shape
 * - Backfill nullable summary, metadata, and entry counts deterministically
 * - Reject unknown/newer versions loudly (never misread forward)
 *
 * Migration is pure and total over readable inputs: every v1 document maps
 * to exactly one v2 document, and v2 documents pass through untouched.
 * Backfills are explicit constants (null/{}/length), never guessed content.
 */

import { SESSION_ENVELOPE_V1, SESSION_ENVELOPE_VERSION, detectEnvelopeVersion } from "./envelope.js";
import type { SessionEntry, SessionRecord } from "@agentprism/contracts";

/** Current (v2) session document. */
export interface SessionDocumentV2 {
  version: 2;
  record: SessionRecord;
  entries: SessionEntry[];
}

/** Migration failure: unknown version or structurally unreadable input. */
export class SessionMigrationError extends Error {
  constructor(reason: string) {
    super(`Session migration failed: ${reason}`);
    this.name = "SessionMigrationError";
  }
}

/** Keeps only string/number/boolean metadata values (drops anything exotic). */
function sanitizeMetadata(value: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!isRecord(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      out[key] = entry;
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new SessionMigrationError(`missing string field ${key}`);
  return value;
}

/** Migrates any readable document to v2 (v2 passes through by value-copy). */
export function migrateToV2(document: unknown): SessionDocumentV2 {
  const version = detectEnvelopeVersion(document);
  if (version === null) throw new SessionMigrationError("unrecognized document shape");
  if (version > SESSION_ENVELOPE_VERSION) {
    throw new SessionMigrationError(`newer version ${version} is not readable by this migrator`);
  }
  if (!isRecord(document)) throw new SessionMigrationError("document is not an object");
  const recordRaw = document.record;
  const entriesRaw = document.entries;
  if (!isRecord(recordRaw)) throw new SessionMigrationError("missing record object");
  if (!Array.isArray(entriesRaw)) throw new SessionMigrationError("missing entries array");
  const record: SessionRecord = {
    id: requireString(recordRaw, "id"),
    kind: recordRaw.kind === "arena" || recordRaw.kind === "agent" || recordRaw.kind === "builder" ? recordRaw.kind : "agent",
    title: typeof recordRaw.title === "string" ? recordRaw.title : "(untitled)",
    status: recordRaw.status === "completed" || recordRaw.status === "failed" || recordRaw.status === "cancelled"
      ? recordRaw.status
      : "active",
    createdAt: typeof recordRaw.createdAt === "number" ? recordRaw.createdAt : 0,
    updatedAt: typeof recordRaw.updatedAt === "number"
      ? recordRaw.updatedAt
      : (typeof recordRaw.createdAt === "number" ? recordRaw.createdAt : 0),
    summary: typeof recordRaw.summary === "string" ? recordRaw.summary : null,
    metadata: sanitizeMetadata(recordRaw.metadata),
    entryCount: typeof recordRaw.entryCount === "number" ? recordRaw.entryCount : entriesRaw.length,
  };
  const entries: SessionEntry[] = [];
  for (const raw of entriesRaw) {
    if (!isRecord(raw)) throw new SessionMigrationError("entry is not an object");
    const kind = raw.kind === "verdict" || raw.kind === "note" ? raw.kind : "lifecycle";
    entries.push({
      sessionId: typeof raw.sessionId === "string" ? raw.sessionId : record.id,
      seq: typeof raw.seq === "number" ? raw.seq : entries.length,
      at: typeof raw.at === "number" ? raw.at : 0,
      kind,
      content: typeof raw.content === "string" ? raw.content : "",
    });
  }
  if (version === SESSION_ENVELOPE_V1) {
    // v1 carried no entryCount: recount from entries (source of truth).
    record.entryCount = entries.length;
  }
  return { version: 2, record, entries };
}
