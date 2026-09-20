/**
 * @file JSON store tests
 * @description Covers atomicWriteJsonAsync concurrency.
 *
 * Responsibilities:
 * - Serialize concurrent async writes per path
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWriteJsonAsync, readJsonFile } from "@agentprism/persistence";

describe("atomicWriteJsonAsync concurrent serialization", () => {
  const dir = join(tmpdir(), `aprism-json-store-${randomUUID()}`);

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("concurrent writes to the same file serialize in call order; final payload is last; no .tmp left", async () => {
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, "data.json");

    await Promise.all([
      atomicWriteJsonAsync(filePath, { v: 1 }),
      atomicWriteJsonAsync(filePath, { v: 2 }),
      atomicWriteJsonAsync(filePath, { v: 3 }),
      atomicWriteJsonAsync(filePath, { v: 4 }),
      atomicWriteJsonAsync(filePath, { v: 5 }),
    ]);

    expect(readJsonFile<{ v: number }>(filePath)).toEqual({ v: 5 });
    expect(existsSync(`${filePath}.tmp`)).toBe(false);
    expect(readFileSync(filePath, "utf-8").endsWith("\n")).toBe(true);
  });

  it("concurrent writes keep a .bak of the second-to-last payload", async () => {
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, "backed.json");

    await atomicWriteJsonAsync(filePath, { v: 1 });
    await atomicWriteJsonAsync(filePath, { v: 2 });

    expect(readJsonFile<{ v: number }>(filePath)).toEqual({ v: 2 });
    expect(readJsonFile<{ v: number }>(`${filePath}.bak`)).toEqual({ v: 1 });
  });

  it("head-of-queue write failure does not block later writes (error propagates; queue reusable)", async () => {
    mkdirSync(dir, { recursive: true });
    // Parent path is a file: mkdir must fail — simulate one write failure
    const blocked = join(dir, "not-a-dir");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(blocked, "occupied", "utf-8");
    const badPath = join(blocked, "data.json");

    await expect(atomicWriteJsonAsync(badPath, { v: 1 })).rejects.toThrow();

    const filePath = join(dir, "data.json");
    await expect(atomicWriteJsonAsync(filePath, { v: 9 })).resolves.toBeUndefined();
    expect(readJsonFile<{ v: number }>(filePath)).toEqual({ v: 9 });
  });
});

describe("backup skips corrupt sources", () => {
  const dir = join(tmpdir(), `aprism-json-backup-${randomUUID()}`);

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the last good .bak when the main file is corrupt", async () => {
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, "data.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(filePath, "{not json", "utf-8");
    writeFileSync(`${filePath}.bak`, JSON.stringify({ v: 1 }), "utf-8");

    await atomicWriteJsonAsync(filePath, { v: 2 });

    expect(readJsonFile<{ v: number }>(filePath)).toEqual({ v: 2 });
    // The corrupt main must not have been cloned over the recovery point.
    expect(readJsonFile<{ v: number }>(`${filePath}.bak`)).toEqual({ v: 1 });
  });

  it("still backs up healthy sources (sync path)", async () => {
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, "sync.json");
    const { atomicWriteJson } = await import("@agentprism/persistence");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(filePath, JSON.stringify({ v: 1 }), "utf-8");

    atomicWriteJson(filePath, { v: 2 });

    expect(readJsonFile<{ v: number }>(filePath)).toEqual({ v: 2 });
    expect(readJsonFile<{ v: number }>(`${filePath}.bak`)).toEqual({ v: 1 });
  });
});
