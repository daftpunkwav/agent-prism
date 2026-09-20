/**
 * @file session-projection/cache
 * @description Digest-keyed projection cache with explicit invalidation.
 *
 * Responsibilities:
 * - Cache digest rows and verdict rollups keyed by content digest
 * - Invalidate on digest mismatch (no timers, no watchers)
 * - Bound memory with LRU eviction over session ids
 *
 * The host computes the digest (record.updatedAt + entryCount is sufficient
 * for store-backed sessions); the cache skips recomputation on hits and
 * reports hit/miss counters for observability. Eviction is LRU over session
 * ids with a fixed capacity.
 */

import type { SessionDocumentV2 } from "@agentprism/session-format";
import { projectDigest, rollupVerdicts, type SessionDigest, type VerdictRollup } from "./projection.js";

/** Max cached sessions (LRU). */
export const PROJECTION_CACHE_CAP = 500;

/** Cached view for one session digest key. */
export interface CachedProjection {
  digest: string;
  row: SessionDigest;
  rollup: VerdictRollup;
}

/** Digest-keyed LRU projection cache. */
export class ProjectionCache {
  private readonly views = new Map<string, CachedProjection>();
  private hits = 0;
  private misses = 0;

  /** Cache hit count (lifetime). */
  hitCount(): number {
    return this.hits;
  }

  /** Cache miss count (lifetime). */
  missCount(): number {
    return this.misses;
  }

  /** Current entry count. */
  get size(): number {
    return this.views.size;
  }

  /**
   * Returns the cached view when the digest matches, else recomputes.
   * Recomputation refreshes LRU position; over-capacity evicts the stalest id.
   */
  view(sessionId: string, digest: string, document: SessionDocumentV2): CachedProjection {
    const cached = this.views.get(sessionId);
    if (cached !== undefined && cached.digest === digest) {
      this.views.delete(sessionId);
      this.views.set(sessionId, cached);
      this.hits += 1;
      return cached;
    }
    this.misses += 1;
    const fresh: CachedProjection = {
      digest,
      row: projectDigest(document),
      rollup: rollupVerdicts(sessionId, Array.isArray(document.entries) ? document.entries : []),
    };
    this.views.delete(sessionId);
    this.views.set(sessionId, fresh);
    while (this.views.size > PROJECTION_CACHE_CAP) {
      const oldest = this.views.keys().next();
      if (oldest.done === true) break;
      this.views.delete(oldest.value);
    }
    return fresh;
  }

  /** Drops one session (returns false when absent). */
  invalidate(sessionId: string): boolean {
    return this.views.delete(sessionId);
  }

  /** Drops everything and resets counters. */
  clear(): void {
    this.views.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

/** Computes a digest key from record.updatedAt plus entry count. */
export function digestFor(updatedAt: number, entryCount: number): string {
  return `${Number.isFinite(updatedAt) ? updatedAt : 0}:${Number.isFinite(entryCount) ? entryCount : 0}`;
}
