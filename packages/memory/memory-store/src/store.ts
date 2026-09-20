/**
 * @file store
 * @description In-memory search index with atomic file persistence for memory items.
 *
 * Responsibilities:
 * - Load and atomically persist structured collections of memory items
 * - Provide multi-language tokenization (CJK + Latin word segmentation)
 * - Provide term-frequency search ranking over text representations
 * - Crash-safe across restarts via AtomicJsonFile (atomic replace + backup recovery)
 */

import { AtomicJsonFile } from "@agentprism/persistence";

/** Tokenizer supporting Latin words and CJK character grams. */
export function tokenizeText(text: string): string[] {
  const normalized = text.toLowerCase();
  const tokens: string[] = [];
  // Latin / alphanumeric words
  const words = normalized.match(/[a-z0-9_-]+/g) ?? [];
  tokens.push(...words);
  // CJK characters (bi-grams and unigrams for robust partial matching)
  const cjkChars = normalized.match(/[\u4e00-\u9fa5]/g) ?? [];
  for (let i = 0; i < cjkChars.length; i += 1) {
    tokens.push(cjkChars[i] as string);
    if (i < cjkChars.length - 1) {
      tokens.push(`${cjkChars[i]}${cjkChars[i + 1]}`);
    }
  }
  return tokens;
}

export interface MemoryDocument<T> {
  item: T;
  searchTokens: string[];
  rawText: string;
}

export interface MemoryStoreOptions {
  /** Optional file path for atomic JSON persistence. If omitted, operates purely in memory. */
  filePath?: string;
}

/**
 * Generic indexed memory store backing episodic and semantic memory collections.
 */
export class MemoryStore<T extends { id: string }> {
  private readonly items = new Map<string, MemoryDocument<T>>();
  private readonly file: AtomicJsonFile | null = null;
  private readonly extractSearchText: (item: T) => string;

  constructor(
    extractSearchText: (item: T) => string,
    options: MemoryStoreOptions = {},
  ) {
    this.extractSearchText = extractSearchText;
    if (options.filePath) {
      this.file = new AtomicJsonFile(options.filePath);
      this.load();
    }
  }

  get size(): number {
    return this.items.size;
  }

  /** Loads persisted items from disk into memory and builds the inverted search index. */
  private load(): void {
    if (!this.file) return;
    try {
      const persisted = this.file.read<T[]>() ?? [];
      for (const item of persisted) {
        if (item && typeof item.id === "string") {
          const rawText = this.extractSearchText(item);
          this.items.set(item.id, {
            item,
            rawText,
            searchTokens: tokenizeText(rawText),
          });
        }
      }
    } catch (error) {
      console.warn(`[memory-store] Failed to load persisted items: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Flushes current memory state to disk atomically. */
  private async persist(): Promise<void> {
    if (!this.file) return;
    const array = Array.from(this.items.values()).map((d) => d.item);
    await this.file.write(array);
  }

  /** Saves or updates an item in the store. */
  async save(item: T): Promise<T> {
    const rawText = this.extractSearchText(item);
    const doc: MemoryDocument<T> = {
      item,
      rawText,
      searchTokens: tokenizeText(rawText),
    };
    this.items.set(item.id, doc);
    await this.persist();
    return item;
  }

  /** Retrieves an item by its unique ID. */
  get(id: string): T | undefined {
    return this.items.get(id)?.item;
  }

  /** Lists all items currently in the store. */
  list(): readonly T[] {
    return Array.from(this.items.values()).map((d) => d.item);
  }

  /** Removes an item by ID. Returns true if removed. */
  async delete(id: string): Promise<boolean> {
    const removed = this.items.delete(id);
    if (removed) {
      await this.persist();
    }
    return removed;
  }

  /** Clears all items. */
  async clear(): Promise<void> {
    this.items.clear();
    await this.persist();
  }

  /**
   * Searches the store using term-frequency ranking over exact token matches.
   * Returns at most `limit` hits sorted by descending score.
   */
  search(query: string, limit = 3): Array<{ item: T; score: number }> {
    const queryTokens = tokenizeText(query);
    const capped = Math.max(0, Math.trunc(limit));
    if (queryTokens.length === 0 || this.items.size === 0 || capped === 0) {
      return [];
    }

    const querySet = new Set(queryTokens);
    const scored: Array<{ item: T; score: number }> = [];

    for (const doc of this.items.values()) {
      let matchCount = 0;
      let totalTokenScore = 0;

      // Calculate term frequency overlaps
      for (const token of doc.searchTokens) {
        if (querySet.has(token)) {
          matchCount += 1;
          totalTokenScore += token.length > 3 ? 1.5 : 1.0;
        }
      }

      if (matchCount > 0) {
        // Normalization against document length to prevent long text bias
        const normFactor = Math.log2(doc.searchTokens.length + 2);
        const score = Number(((totalTokenScore / normFactor) * (matchCount / queryTokens.length)).toFixed(4));
        scored.push({ item: doc.item, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, capped);
  }
}
