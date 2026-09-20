/**
 * @file session-query/export-doc
 * @description Versioned export envelope assembly for backup and forensics.
 *
 * Responsibilities:
 * - Assemble `{version, exportedAt, record, entries}` export documents
 * - Stamp export time from the injected clock (never ambient time)
 * - Keep export a pure assembly over caller-loaded snapshots
 *
 * Export carries the session-format envelope version so restores route
 * through the migrator: today's exports restore even after future format
 * bumps. Assembly never reads storage; the host loads record plus entries.
 */

import type { SessionEntry, SessionRecord } from "@agentprism/contracts";
import { SESSION_ENVELOPE_VERSION } from "@agentprism/session-format";

/** Versioned export document (single session). */
export interface SessionExportDocument {
  version: number;
  exportedAt: number;
  record: SessionRecord;
  entries: SessionEntry[];
}

/**
 * Assembles an export document (entries sorted by seq ascending).
 * Sparse seqs are preserved as-is; validation (not export) judges density.
 */
export function exportSessionDocument(
  record: SessionRecord,
  entries: readonly SessionEntry[],
  exportedAt: number,
): SessionExportDocument {
  const ordered = [...entries].sort((a, b) => a.seq - b.seq);
  return {
    version: SESSION_ENVELOPE_VERSION,
    exportedAt: Number.isFinite(exportedAt) ? exportedAt : 0,
    record,
    entries: ordered,
  };
}
