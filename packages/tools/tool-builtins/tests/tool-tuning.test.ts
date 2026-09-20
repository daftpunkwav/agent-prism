/**
 * @file tool tuning tests
 * @description Locks the composition-time tool tuning seam: tuned values reach
 * the builtin tools at execute time, and absent fields keep built-in defaults.
 *
 * Responsibilities:
 * - Pin toolTuningValue fallback semantics (unset, set, non-finite)
 * - Pin the read cap following the tuned maxFileChars on a real execute
 * - Pin the webfetch definition metadata timeout following the tuned value
 */

import { afterEach, describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";
import { readTool, setToolTuning, toolTuningValue, webfetchTool } from "../src/index.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

afterEach(() => {
  setToolTuning({});
});

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-tuning-"));
  return {
    name: "ws",
    root,
    cwd: () => root,
    fs: new ScopedFileSystem(root),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe("tool tuning seam", () => {
  it("toolTuningValue falls back to the built-in default when unset or non-finite", () => {
    setToolTuning({});
    expect(toolTuningValue("maxFileChars", 100)).toBe(100);
    setToolTuning({ maxFileChars: 7 });
    expect(toolTuningValue("maxFileChars", 100)).toBe(7);
    setToolTuning({ maxFileChars: Number.NaN });
    expect(toolTuningValue("maxFileChars", 100)).toBe(100);
  });

  it("read honors the tuned file cap on a real execute", async () => {
    setToolTuning({ maxFileChars: 10 });
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile("big.txt", "x".repeat(50));
      const result = await readTool.execute(ws, { path: "big.txt" });
      expect(result.ok).toBe(true);
      // Cap 10 chars + the truncate marker; well below the 50-char file.
      expect(result.result.length).toBeLessThan(50);
    } finally {
      ws.cleanup();
    }
  });

  it("webfetch definition timeout metadata follows the tuned value", () => {
    setToolTuning({ webFetchTimeoutMs: 45_000 });
    expect(webfetchTool.timeoutMs).toBe(45_000);
    setToolTuning({});
    expect(webfetchTool.timeoutMs).toBe(15_000);
  });
});
