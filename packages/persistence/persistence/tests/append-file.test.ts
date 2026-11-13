/**
 * @file append-file tests
 * @description Covers NodeAppendFile owner-only creation on POSIX hosts.
 *
 * Responsibilities:
 * - Pin 0o600 log files and 0o700 newly created parent directories
 * - Pin that an atomic rewrite carries the private mode onto an existing file
 */

import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeAppendFile } from "@agentprism/persistence";

/** POSIX mode bits only; Windows ignores them, so every case here skips there. */
const modeOf = (path: string): number => statSync(path).mode & 0o777;

describe.skipIf(process.platform === "win32")("NodeAppendFile owner-only modes (POSIX)", () => {
  const dir = join(tmpdir(), `aprism-append-file-${randomUUID()}`);

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the log file 0o600 and its new parent directory 0o700", async () => {
    const parent = join(dir, "nested");
    const filePath = join(parent, "journal.jsonl");
    const file = new NodeAppendFile(filePath);

    await file.append(["line-1"]);

    expect(modeOf(filePath)).toBe(0o600);
    expect(modeOf(parent)).toBe(0o700);
  });

  it("rewrites an existing world-readable log as owner-only", async () => {
    const filePath = join(dir, "existing.jsonl");
    writeFileSync(filePath, "old\n", "utf-8");
    chmodSync(filePath, 0o644);
    expect(modeOf(filePath)).toBe(0o644);
    const file = new NodeAppendFile(filePath);

    await file.rewrite(["new"]);

    expect(modeOf(filePath)).toBe(0o600);
    expect(existsSync(`${filePath}.tmp`)).toBe(false);
    await expect(file.readLines()).resolves.toEqual(["new"]);
  });
});
