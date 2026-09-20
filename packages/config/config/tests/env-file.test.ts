/**
 * @file env file tests
 * @description Covers the minimal .env parser.
 *
 * Responsibilities:
 * - Pin KEY=VALUE parsing with quotes, export prefixes, and comment lines
 * - Lock the missing-file (silent) vs read-error (warned) degradation
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnvFile } from "../src/env-file.js";

describe("loadEnvFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), `aprism-env-${randomUUID()}`));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses quoted values, export prefixes, and skips comments/blank/malformed lines", () => {
    const file = join(dir, ".env");
    writeFileSync(
      file,
      [
        "# comment",
        "",
        "PLAIN=value",
        'QUOTED="quoted value"',
        "SINGLE='single'",
        "export EXPORTED=yes",
        "=nokey",
        "NOVALUE",
      ].join("\n"),
      "utf-8",
    );
    expect(loadEnvFile(file)).toEqual({
      PLAIN: "value",
      QUOTED: "quoted value",
      SINGLE: "single",
      EXPORTED: "yes",
    });
  });

  it("returns empty for a missing file without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadEnvFile(join(dir, "ghost.env"))).toEqual({});
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns (and returns empty) for read errors other than missing files", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const victim = join(dir, "broken.env");
    writeFileSync(victim, "A=1", "utf-8");
    rmSync(victim);
    // Re-create the path as a directory so the read fails with EISDIR, not ENOENT.
    mkdirSync(victim);
    expect(loadEnvFile(victim)).toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
