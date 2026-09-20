/**
 * @file rag
 * @description Workspace RAG over the centralized context leaves.
 *
 * Responsibilities:
 * - Ingest workspace files through structure-aware chunking
 * - Serve BM25 retrieval with a per-run cache
 * - Dedupe first-round snippet injection
 *
 * Thin seam over `@agentprism/context-chunking` (ingestion) and
 * `@agentprism/context-retrieval` (BM25 scoring): ranking internals live
 * there with their own tests; this module owns workspace IO policy (ingest
 * ceilings, failure warnings, cache lifecycle) and the snippet framing the
 * drivers consume. Public function signatures are unchanged, except the
 * store type (SimpleVectorStore removed; ChunkIndex is the store now).
 */

import type { ScopedFileSystem } from "@agentprism/environment";
import { chunkFile } from "@agentprism/context-chunking";
import { ChunkIndex } from "@agentprism/context-retrieval";

/** Per-file ingest ceiling (bytes): only the 4000-char head is indexed, so reading a giant file fully just to slice it wastes memory. */
const MAX_INGEST_BYTES = 256 * 1024;

/** Builds a retrieval index from workspace files; returns null on no files or build failure (pure function, no caching). */
export function buildRagStore(workspace: { fs: ScopedFileSystem }): ChunkIndex | null {
  try {
    const files = workspace.fs.listFiles("", { recursive: true });
    if (files.length === 0) return null;
    const index = new ChunkIndex();
    const sizes = new Map(workspace.fs.listFileEntries().map((entry) => [entry.path, entry.size]));
    let skippedLarge = 0;
    let ingested = 0;
    for (const filePath of files) {
      if (filePath.endsWith(".gitkeep")) continue;
      // Size precheck before the unbounded read below: a model-written 100MB log must not
      // be materialized fully in memory when only its head is indexed. Counted, not silent.
      if ((sizes.get(filePath) ?? 0) > MAX_INGEST_BYTES) {
        skippedLarge += 1;
        continue;
      }
      try {
        const text = workspace.fs.readFile(filePath);
        const chunks = chunkFile(filePath, text.slice(0, 4000));
        if (chunks.length === 0) continue;
        index.add(
          chunks.map((chunk) => ({
            path: chunk.path,
            content: chunk.location === "" ? chunk.content : `${chunk.content}`,
            ageRank: Number.MAX_SAFE_INTEGER,
          })),
        );
        ingested += chunks.length;
      } catch (error) {
        // A single-file ingestion failure loses retrieval content; silently skipping would mask the problem
        console.warn(`[harness] RAG file ingest failed, skipping ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }
    if (skippedLarge > 0) {
      console.warn(`[harness] RAG ingest skipped ${skippedLarge} files over ${MAX_INGEST_BYTES} bytes (head-only index)`);
    }
    return ingested === 0 ? null : index;
  } catch (error) {
    console.warn(`[harness] RAG store build failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Weakly-referenced cache of workspace → RAG store (held per instance, destroyed with the run lifecycle). */
export class RagStoreCache {
  private readonly cache = new WeakMap<object, ChunkIndex | null>();

  /** Returns the cached store; builds and caches on miss. */
  get(workspace: { fs: ScopedFileSystem }): ChunkIndex | null {
    const cached = this.cache.get(workspace);
    if (cached !== undefined) return cached;
    const built = buildRagStore(workspace);
    this.cache.set(workspace, built);
    return built;
  }

  /** Invalidates the cache after file changes (rebuilt on next query). */
  invalidate(workspace: object): void {
    this.cache.delete(workspace);
  }
}

/** Retrieves workspace snippets, joined with "\n---\n"; returns an empty string on failure. */
export function queryWorkspaceSnippets(
  cache: RagStoreCache,
  workspace: { fs: ScopedFileSystem },
  query: string,
  topK = 3,
): string {
  try {
    // No pre-check for an empty workspace: buildRagStore returns null for an empty set and it is cached; write tools invalidate the cache
    const store = cache.get(workspace);
    if (store === null) return "";
    const hits = store.query(query, topK);
    if (hits.length === 0) return "";
    return hits.map((hit) => hit.content.slice(0, 400)).join("\n---\n");
  } catch (error) {
    // Retrieval failures degrade to empty snippets; leave a trace so silent context-injection loss is visible
    console.warn(`[harness] RAG retrieval failed: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

/**
 * First-call dedup wrapper: buildSystemUser already injects the question's retrieved
 * snippets into the user text, so the first LLM call skips per-call injection to avoid
 * doubling the same snippets in context; every later model call injects as usual
 * (each call's message window needs the snippets re-attached).
 */
export function dedupeInitialInjection(retrieve: (query: string) => string): (query: string) => string {
  let firstCall = true;
  return (query: string) => {
    if (firstCall) {
      firstCall = false;
      return "";
    }
    return retrieve(query);
  };
}

/**
 * Per-column retrieval callback: vector/hybrid retrieve workspace snippets before each
 * model call; the first turn was already injected by buildSystemUser, so the wrapper
 * skips that column's first call (each call's query is the full text of the last human
 * message in the window, slightly different from the first turn's pure question — an
 * accepted nuance). Must be called once inside each column's run path — each column
 * holds its own wrapper; hoisting it to module-level sharing would silently skip the
 * second column's first-turn retrieval. Locked by tests/rag-dedupe.test.ts.
 */
export function createColumnSnippetRetriever(
  cache: RagStoreCache,
  workspace: { fs: ScopedFileSystem },
): (query: string) => string {
  return dedupeInitialInjection((query) => queryWorkspaceSnippets(cache, workspace, query));
}
