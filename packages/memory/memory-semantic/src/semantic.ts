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

/** Default fact ceiling: past this, the store drops the least valuable facts. */
export const DEFAULT_MAX_SEMANTIC_FACTS = 5_000;

export interface SemanticMemoryOptions {
  /** Optional file path for atomic JSON persistence (omitted = in-memory only). */
  filePath?: string;
  /** Time source in ms epoch (injected; defaults to Date.now). */
  now?: () => number;
  /**
   * Maximum facts held. Expired facts go first, then the least confident, then the
   * oldest: an unbounded fact store grows for the life of the deployment, and the
   * per-write cost with it.
   */
  maxFacts?: number;
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
  private readonly maxFacts: number;
  private idCounter = 0;

  constructor(options: SemanticMemoryOptions = {}) {
    this.store = new MemoryStore<SemanticFact>(semanticSearchText, { filePath: options.filePath });
    this.now = options.now ?? Date.now;
    const maxFacts = options.maxFacts ?? DEFAULT_MAX_SEMANTIC_FACTS;
    this.maxFacts = Number.isFinite(maxFacts) ? Math.max(1, Math.trunc(maxFacts)) : DEFAULT_MAX_SEMANTIC_FACTS;
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
        // Refresh in place. No capacity dance here: an update does not grow the store,
        // and evicting a fact to record this one would drop unrelated knowledge (the
        // weakest fact could be the very one being refreshed).
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
    // Room for the fact about to be inserted, so the cap holds once this call returns.
    await this.enforceCapacity(1);
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

  /** Removes expired facts; returns the number pruned (one persist for the batch). */
  async pruneExpired(now?: number): Promise<number> {
    const at = now ?? this.now();
    const expired = this.store.list().filter((fact) => !isFactEffective(fact, at)).map((fact) => fact.id);
    return expired.length === 0 ? 0 : this.store.deleteMany(expired);
  }

  /**
   * Trims the store down to `maxFacts`, dropping the least valuable facts first:
   * lowest confidence, then oldest, with the id as a stable tie-break. Facts that
   * are referenced again get refreshed (see recordFact), so the cap costs the
   * weakest long-tail knowledge rather than whatever was written last.
   */
  private async enforceCapacity(pending: number = 0): Promise<number> {
    const overflow = this.store.size + pending - this.maxFacts;
    if (overflow <= 0) return 0;
    const weakest = [...this.store.list()]
      .sort((a, b) => a.confidence - b.confidence || a.validFrom - b.validFrom || a.id.localeCompare(b.id))
      .slice(0, overflow)
      .map((fact) => fact.id);
    return this.store.deleteMany(weakest);
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
