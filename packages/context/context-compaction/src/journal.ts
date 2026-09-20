/**
 * @file context-compaction/journal
 * @description Append-only compaction journal with undo and sequence guards.
 *
 * Responsibilities:
 * - Record every compaction as a journal entry (span, checkpoint, savings)
 * - Undo the latest entry (pop) for rollback paths
 * - Guard sequence continuity so concurrent compactions cannot interleave
 *
 * The journal is the audit trail that makes compaction reviewable: which
 * frames condensed into which checkpoint, how many tokens were saved, and in
 * what order. Entries are immutable once appended; only pop removes the tail.
 */

import type { Checkpoint } from "./checkpoint.js";
import { renderCheckpoint } from "./checkpoint.js";
import type { CompactionSpan } from "./surface.js";

/** One recorded compaction. */
export interface JournalEntry {
  /** Monotonic sequence (1-based, gapless per journal). */
  seq: number;
  /** Span condensed. */
  span: CompactionSpan;
  /** Checkpoint produced. */
  checkpoint: Checkpoint;
  /** Estimated tokens before compaction (span tokens). */
  beforeTokens: number;
  /** Estimated tokens after (rendered checkpoint chars via proxy). */
  afterTokens: number;
  /** Wall-clock ms supplied by the host (ordering aid, never a time source). */
  at: number;
}

/** Append-only journal of compactions. */
export class CompactionJournal {
  private readonly entries: JournalEntry[] = [];

  /** Entry count. */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Appends an entry: seq must continue the journal (1 when empty).
   * Throws on sequence gaps so interleaved writers fail loudly.
   */
  append(entry: Omit<JournalEntry, "seq"> & { seq?: number }): JournalEntry {
    const expected = this.entries.length + 1;
    const seq = entry.seq ?? expected;
    if (seq !== expected) {
      throw new Error(`Compaction journal sequence gap: expected ${expected}, got ${seq}`);
    }
    const full: JournalEntry = { ...entry, seq };
    this.entries.push(full);
    return full;
  }

  /** Latest entry without removing (undefined when empty). */
  peek(): JournalEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  /**
   * Removes and returns the latest entry for rollback (undefined when empty).
   * Only the tail pops: history is immutable otherwise.
   */
  pop(): JournalEntry | undefined {
    return this.entries.pop();
  }

  /** Total tokens saved across entries (before minus after, floored at 0). */
  totalSaved(): number {
    return this.entries.reduce((sum, entry) => sum + Math.max(0, entry.beforeTokens - entry.afterTokens), 0);
  }

  /** Human-readable audit lines, newest last. */
  audit(): string[] {
    return this.entries.map(
      (entry) =>
        `#${entry.seq} frames[${entry.span.start}-${entry.span.end}] ` +
        `${entry.beforeTokens}→${entry.afterTokens} tokens (${entry.checkpoint.frameIds.length} frames)`,
    );
  }

  /** Renders the latest checkpoint envelope (empty string when no entries). */
  latestCheckpointText(): string {
    const latest = this.peek();
    return latest === undefined ? "" : renderCheckpoint(latest.checkpoint);
  }
}
