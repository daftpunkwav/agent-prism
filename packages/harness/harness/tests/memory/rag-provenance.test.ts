/**
 * @file RAG source labels and freshness tests
 * @description Locks snippet provenance and the recency ranking the index advertises.
 *
 * Responsibilities:
 * - Pin the source label prepended to chunks that arrive without one
 * - Pin that a fresher file outranks a stale one for the same content
 */

import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";
import { buildRagStore, queryWorkspaceSnippets, RagStoreCache } from "../../src/memory/rag.js";

describe("RAG snippet provenance and freshness", () => {
  it("labels retrieved snippets with the file they came from", () => {
    const root = mkdtempSync(join(tmpdir(), "aprism-rag-src-"));
    try {
      const fs = new ScopedFileSystem(root);
      fs.writeFile("notes.md", "# Notes\n\nthe pangolin migration plan lives here");
      const workspace = { fs };
      const hit = queryWorkspaceSnippets(new RagStoreCache(), workspace, "pangolin migration");
      // The prompt asks the model to cite paths; a snippet with no source makes that a guess.
      expect(hit).toContain("notes.md");
      expect(hit).toContain("pangolin");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ranks the more recently modified file first when the text ties", () => {
    const root = mkdtempSync(join(tmpdir(), "aprism-rag-fresh-"));
    try {
      const fs = new ScopedFileSystem(root);
      // Identical content: only the mtime can break the tie, which is exactly what
      // the index's recency multiplier exists for.
      const body = "identical wording about pangolins and their migration plan";
      writeFileSync(join(root, "stale.md"), body);
      writeFileSync(join(root, "fresh.md"), body);
      const old = new Date(Date.now() - 86_400_000);
      utimesSync(join(root, "stale.md"), old, old);
      const store = buildRagStore({ fs });
      expect(store).not.toBeNull();
      const hits = store!.query("pangolin migration", 2);
      expect(hits.map((hit) => hit.path)).toEqual(["fresh.md", "stale.md"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
