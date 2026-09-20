/**
 * @file RAG ingest tests
 * @description Locks oversized-file skipping during store builds.
 *
 * Responsibilities:
 * - Pin files over the ingest ceiling are skipped without full reads
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";
import { buildRagStore, queryWorkspaceSnippets, RagStoreCache } from "../../src/memory/rag.js";

describe("buildRagStore oversized-file skip", () => {
  it("indexes small files while skipping files over the ingest ceiling", () => {
    const root = mkdtempSync(join(tmpdir(), "aprism-rag-"));
    try {
      const fs = new ScopedFileSystem(root);
      fs.writeFile("small.txt", "the small file holds zebra token");
      // Disjoint vocabulary (qqq/zzz): any hit for it proves the big file entered the index.
      writeFileSync(join(root, "big.log"), `${"qqq ".repeat(100 * 1024)}zzzmarker`);
      const workspace = { fs };
      const store = buildRagStore(workspace);
      expect(store).not.toBeNull();
      const cache = new RagStoreCache();
      const hit = queryWorkspaceSnippets(cache, workspace, "zebra token");
      expect(hit).toContain("zebra");
      // The skipped file's content never entered the index.
      expect(queryWorkspaceSnippets(cache, workspace, "zzzmarker")).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
