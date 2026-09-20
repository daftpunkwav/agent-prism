/**
 * @file file blob store tests
 * @description Covers the filesystem blob sidecar used for oversized ledger entries.
 *
 * Responsibilities:
 * - Pin save/load round trips and the null-on-missing read degradation
 * - Lock filename sanitization and per-session purge semantics
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileBlobStore } from "../src/file-blob-store.js";

describe("FileBlobStore", () => {
  let dir: string;
  let store: FileBlobStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), `aprism-blob-${randomUUID()}`));
    store = new FileBlobStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips blob text through save and load", async () => {
    await store.saveBlob("session 1", 3, "big body".repeat(10));
    await expect(store.loadBlob("session 1", 3)).resolves.toBe("big body".repeat(10));
  });

  it("reads unknown blobs as null instead of throwing", async () => {
    await expect(store.loadBlob("missing", 1)).resolves.toBeNull();
  });

  it("sanitizes session ids in filenames and treats ids as stable keys", async () => {
    await store.saveBlob("../evil id/x", 1, "payload");
    // Same (sanitized) key must read back regardless of the raw id spelling.
    await expect(store.loadBlob("../evil id/x", 1)).resolves.toBe("payload");
    expect(FileBlobStore.fileName("../evil id/x", 1)).toMatch(/\.1\.blob\.txt$/);
    expect(FileBlobStore.fileName("", 1)).toContain("session.1");
  });

  it("purges one session's blobs and reports whether anything was removed", async () => {
    await store.saveBlob("s1", 1, "a");
    await store.saveBlob("s1", 2, "b");
    await store.saveBlob("s2", 1, "c");
    await expect(store.deleteSessionBlobs("s1")).resolves.toBe(true);
    await expect(store.loadBlob("s1", 1)).resolves.toBeNull();
    await expect(store.loadBlob("s1", 2)).resolves.toBeNull();
    await expect(store.loadBlob("s2", 1)).resolves.toBe("c"); // other sessions untouched
    await expect(store.deleteSessionBlobs("s1")).resolves.toBe(false); // nothing left
  });

  it("purging a session with no directory reports false without throwing", async () => {
    const ghost = new FileBlobStore(join(dir, "does-not-exist"));
    await expect(ghost.deleteSessionBlobs("s1")).resolves.toBe(false);
  });
});
