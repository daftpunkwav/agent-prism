/**
 * @file semantic
 * @description Semantic memory: structured facts, conventions, and preferences.
 *
 * Responsibilities:
 * - Record and update subject/predicate/object facts with confidence
 * - Enforce validity windows (validFrom/validUntil) and TTL expiry
 * - Recall relevant non-expired facts for a query
 *
 * Depends only on @agentprism/contracts (schemas) and
 * @agentprism/memory-store (atomic persistence + search index).
 */

import type { MemoryRecallOptions, SemanticFact } from "@agentprism/contracts";
import { MemoryStore } from "@agentprism/memory-store";

export interface SemanticMemoryOptions {
  /** Optional file path for atomic JSON persistence (omitted = in-memory only). */
  filePath?: string;
  /** Time source in ms epoch (injected; defaults to Date.now). */
  now?: () => number;
}

/** Search text combining the fact triple, source, and confidence. */
export function semanticSearchText(fact: SemanticFact): string {
  return [fact.subject, fact.predicate, fact.object, fact.source].join(" ");
}

/** Whether a fact is effective at `now` (handles open-ended validity). */
export function isFactEffective(fact: SemanticFact, now: number): boolean {
  if (fact.validFrom > now) return false;
  if (fact.validUntil !== undefined && fact.validUntil !== 0 && fact.validUntil <= now) return false;
  return true;
}

function normalizePart(part: string): string {
  return part.trim().toLowerCase();
}

/**
 * Semantic fact store with TTL expiry: expired facts are invisible to recall
 * and pruned lazily on write.
 */
export class SemanticMemory {
  private readonly store: MemoryStore<SemanticFact>;
  private readonly now: () => number;
  private idCounter = 0;

  constructor(options: SemanticMemoryOptions = {}) {
    this.store = new MemoryStore<SemanticFact>(semanticSearchText, { filePath: options.filePath });
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.store.size;
  }

  /**
   * Records a fact. An existing fact with the same normalized
   * subject/predicate/object triple is updated in place (confidence, validity
   * window, and source refresh) instead of duplicated.
   */
  async recordFact(fact: Omit<SemanticFact, "id">): Promise<SemanticFact> {
    await this.pruneExpired();
    const key = [normalizePart(fact.subject), normalizePart(fact.predicate), normalizePart(fact.object)].join("|");
    for (const existing of this.store.list()) {
      const existingKey = [normalizePart(existing.subject), normalizePart(existing.predicate), normalizePart(existing.object)].join("|");
      if (existingKey === key) {
        const merged: SemanticFact = {
          ...existing,
          confidence: fact.confidence,
          validFrom: fact.validFrom,
          validUntil: fact.validUntil,
          source: fact.source || existing.source,
        };
        return this.store.save(merged);
      }
    }
    const record: SemanticFact = { ...fact, id: this.nextId() };
    return this.store.save(record);
  }

  /** Recalls up to `limit` (default 5) effective facts matching a query. */
  async recallFacts(query: string, options: MemoryRecallOptions = {}): Promise<readonly SemanticFact[]> {
    const now = options.now ?? this.now();
    const limit = Math.max(1, Math.min(options.limit ?? 5, 20));
    const effective = this.store.list().filter((fact) => isFactEffective(fact, now));
    if (query.trim() === "") {
      return [...effective].sort((a, b) => b.confidence - a.confidence).slice(0, limit);
    }
    const scoped = new MemoryStore<SemanticFact>(semanticSearchText);
    for (const fact of effective) {
      // MemoryStore.save is async only due to persistence; in-memory saves settle immediately.
      await scoped.save(fact);
    }
    const hits = scoped.search(query, limit * 2);
    const threshold = options.threshold;
    const above = threshold !== undefined ? hits.filter((h) => h.score >= threshold) : hits;
    return above.slice(0, limit).map((h) => h.item);
  }

  /** Allocates a collision-free id (safe across restarts replaying one ms). */
  private nextId(): string {
    for (;;) {
      this.idCounter += 1;
      const id = `sem-${this.now()}-${this.idCounter}`;
      if (this.store.get(id) === undefined) return id;
    }
  }

  /** Removes expired facts; returns the number pruned. */
  async pruneExpired(now?: number): Promise<number> {
    const at = now ?? this.now();
    let pruned = 0;
    for (const fact of this.store.list()) {
      if (!isFactEffective(fact, at)) {
        await this.store.delete(fact.id);
        pruned += 1;
      }
    }
    return pruned;
  }

  /** Lists all facts including expired ones (use recallFacts for effective-only). */
  list(): readonly SemanticFact[] {
    return this.store.list();
  }

  /** Clears all facts. */
  async clear(): Promise<void> {
    await this.store.clear();
  }
}
