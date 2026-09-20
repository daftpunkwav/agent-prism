/**
 * @file store tests
 * @description Locks atomic persistence, concurrent safety, and search recall.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, tokenizeText } from "../src/store.js";

interface Note {
  id: string;
  title: string;
  body: string;
}

const extract = (note: Note): string => `${note.title} ${note.body}`;

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "memory-store-"));
  return join(dir, "notes.json");
}

describe("tokenizeText", () => {
  it("segments latin words and CJK grams", () => {
    expect(tokenizeText("Hello World")).toContain("hello");
    const tokens = tokenizeText("项目使用pnpm");
    expect(tokens).toContain("pnpm");
    expect(tokens).toContain("项");
    expect(tokens).toContain("项目");
  });

  it("returns empty for blank input", () => {
    expect(tokenizeText("   ")).toEqual([]);
  });
});

describe("MemoryStore", () => {
  it("saves, gets, lists, and deletes in memory", async () => {
    const store = new MemoryStore<Note>(extract);
    await store.save({ id: "a", title: "vitest setup", body: "uses vitest for tests" });
    expect(store.size).toBe(1);
    expect(store.get("a")?.title).toBe("vitest setup");
    expect(store.list()).toHaveLength(1);
    expect(await store.delete("a")).toBe(true);
    expect(store.size).toBe(0);
    expect(await store.delete("missing")).toBe(false);
  });

  it("ranks relevant documents first and respects limit", async () => {
    const store = new MemoryStore<Note>(extract);
    await store.save({ id: "1", title: "node retry", body: "try node instead of python for scripts" });
    await store.save({ id: "2", title: "python venv", body: "unrelated cooking recipe" });
    await store.save({ id: "3", title: "node version", body: "node version manager pins 20" });
    const hits = store.search("node instead of python", 2);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.item.id).toBe("1");
    expect(store.search("")).toEqual([]);
    expect(store.search("node", 1)).toHaveLength(1);
  });

  it("persists atomically and reloads across restarts", async () => {
    const filePath = tempFile();
    try {
      const first = new MemoryStore<Note>(extract, { filePath });
      await first.save({ id: "x", title: "pnpm workspace", body: "project uses pnpm" });
      const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Note[];
      expect(raw.map((n) => n.id)).toEqual(["x"]);

      const second = new MemoryStore<Note>(extract, { filePath });
      expect(second.get("x")?.title).toBe("pnpm workspace");
      expect(second.search("pnpm")).toHaveLength(1);
    } finally {
      rmSync(join(filePath, ".."), { recursive: true, force: true });
    }
  });

  it("serializes concurrent saves without tearing", async () => {
    const filePath = tempFile();
    try {
      const store = new MemoryStore<Note>(extract, { filePath });
      await Promise.all(
        Array.from({ length: 10 }, (_, i) => store.save({ id: `n${i}`, title: `task ${i}`, body: "shared content" })),
      );
      expect(store.size).toBe(10);
      const reloaded = new MemoryStore<Note>(extract, { filePath });
      expect(reloaded.size).toBe(10);
    } finally {
      rmSync(join(filePath, ".."), { recursive: true, force: true });
    }
  });

  it("recovers from a corrupt main file via backup", async () => {
    const filePath = tempFile();
    try {
      const store = new MemoryStore<Note>(extract, { filePath });
      await store.save({ id: "good", title: "first", body: "payload" });
      await store.save({ id: "good2", title: "second", body: "payload" });
      // Corrupt the main file; the previous .bak holds the last good payload.
      const { writeFileSync } = await import("node:fs");
      writeFileSync(filePath, "{not json", "utf-8");
      const recovered = new MemoryStore<Note>(extract, { filePath });
      expect(recovered.size).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(join(filePath, ".."), { recursive: true, force: true });
    }
  });
});
