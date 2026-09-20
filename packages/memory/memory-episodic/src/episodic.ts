/**
 * @file episodic
 * @description Episodic memory: mini post-mortems of past task executions.
 *
 * Responsibilities:
 * - Record task experiences (goal, tools, errors, self-correction, outcome)
 * - Recall the most relevant past experiences for a new task question
 * - Deduplicate near-identical reports for the same task
 *
 * Depends only on @agentprism/contracts (schemas) and
 * @agentprism/memory-store (atomic persistence + search index).
 */

import type { EpisodicMemoryEntry, MemoryRecallOptions } from "@agentprism/contracts";
import { MemoryStore } from "@agentprism/memory-store";

export interface EpisodicMemoryOptions {
  /** Optional file path for atomic JSON persistence (omitted = in-memory only). */
  filePath?: string;
  /** Time source in ms epoch (injected; defaults to Date.now). */
  now?: () => number;
}

/** Search text combining task, actions, lessons, and outcome. */
export function episodicSearchText(entry: EpisodicMemoryEntry): string {
  return [entry.task, entry.framework, entry.model, entry.keyActions.join(" "), entry.lessons, entry.workspaceTag].join(" ");
}

/** Normalizes a task string for dedup comparison. */
function normalizeTask(task: string): string {
  return task.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Episodic experience store: records mini post-mortems and recalls the
 * 1-3 most relevant ones for a new task question.
 */
export class EpisodicMemory {
  private readonly store: MemoryStore<EpisodicMemoryEntry>;
  private readonly now: () => number;
  private idCounter = 0;

  constructor(options: EpisodicMemoryOptions = {}) {
    this.store = new MemoryStore<EpisodicMemoryEntry>(episodicSearchText, { filePath: options.filePath });
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.store.size;
  }

  /**
   * Records a task experience. A near-duplicate report for the same normalized
   * task with identical success/lessons updates the existing entry instead of
   * appending (keeps recall sharp across repeated runs).
   */
  async recordExperience(entry: Omit<EpisodicMemoryEntry, "id" | "timestamp">): Promise<EpisodicMemoryEntry> {
    const normalized = normalizeTask(entry.task);
    for (const existing of this.store.list()) {
      if (normalizeTask(existing.task) === normalized && existing.success === entry.success && existing.lessons === entry.lessons) {
        const merged: EpisodicMemoryEntry = {
          ...existing,
          keyActions: Array.from(new Set([...existing.keyActions, ...entry.keyActions])),
          timestamp: this.now(),
          workspaceTag: entry.workspaceTag || existing.workspaceTag,
        };
        return this.store.save(merged);
      }
    }
    const record: EpisodicMemoryEntry = {
      ...entry,
      keyActions: [...entry.keyActions],
      id: this.nextId(),
      timestamp: this.now(),
    };
    return this.store.save(record);
  }

  /** Recalls up to `limit` (default 3) relevant experiences for a task query. */
  async recallExperiences(taskQuery: string, options: MemoryRecallOptions = {}): Promise<readonly EpisodicMemoryEntry[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 3, 10));
    // Over-fetch up to the store size so post-filters (workspace tag,
    // threshold) never starve the result when the top hits miss.
    const hits = this.store.search(taskQuery, Math.max(limit * 2, this.store.size));
    const filtered =
      options.workspaceTag !== undefined && options.workspaceTag !== ""
        ? hits.filter((h) => h.item.workspaceTag === "" || h.item.workspaceTag === options.workspaceTag)
        : hits;
    const threshold = options.threshold;
    const above = threshold !== undefined ? filtered.filter((h) => h.score >= threshold) : filtered;
    return above.slice(0, limit).map((h) => h.item);
  }

  /** Allocates a collision-free id (safe across restarts replaying one ms). */
  private nextId(): string {
    for (;;) {
      this.idCounter += 1;
      const id = `ep-${this.now()}-${this.idCounter}`;
      if (this.store.get(id) === undefined) return id;
    }
  }

  /** Lists all recorded experiences (insertion order is not guaranteed). */
  list(): readonly EpisodicMemoryEntry[] {
    return this.store.list();
  }

  /** Clears all recorded experiences. */
  async clear(): Promise<void> {
    await this.store.clear();
  }
}
