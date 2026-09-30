/**
 * @file assemble builder trace guard tests
 * @description Locks the fail-closed containment of builder trace ids at the
 *              composition root: the SessionTraceStore open callback in
 *              assemble.ts refuses any session id that is not a single path-safe
 *              segment, so a hand-crafted sessions file cannot turn an id into a
 *              path traversal under the traces directory.
 *
 * Responsibilities:
 * - Pin the detail route failing loudly (500) for a traversal id, not silently
 *   reading a journal outside the traces directory
 * - Pin that safe hand-crafted ids keep reading (the guard blocks only unsafe ids)
 * - Pin the delete route clearing a traversal-id session without crashing or
 *   writing outside the traces directory
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Data-dir isolation anchor
// ---------------------------------------------------------------------------
// This suite boots the real composition root against a private scratch data
// dir. Plain module statement on purpose: it must run before any import that
// evaluates the config path chain (same anchor as assemble-wiring.test.ts).
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "assemble-trace-guard-"));
process.env.ARENA_DATA_DIR = dataRoot;

// The persisted session schema deliberately admits any non-empty id, so a
// hand-crafted builder_sessions.json can plant traversal ids. These load
// before the store is constructed, which is exactly the threat the open
// callback's guard exists for.
const crafted = {
  version: 1,
  sessions: [
    {
      id: "../escape_read",
      name: "hand crafted traversal",
      createdAt: 1,
      updatedAt: 1,
      composition: {},
      history: [],
    },
    {
      id: "../escape_delete",
      name: "hand crafted traversal two",
      createdAt: 2,
      updatedAt: 2,
      composition: {},
      history: [],
    },
    {
      id: "handcrafted_ok",
      name: "safe reader",
      createdAt: 3,
      updatedAt: 3,
      composition: {},
      history: [],
    },
  ],
};
fs.writeFileSync(path.join(dataRoot, "builder_sessions.json"), JSON.stringify(crafted), "utf-8");

const COMPOSITION_TIMEOUT = 120_000;

/** Minimal surface of the assembled Hono app the suite drives. */
let app: { request: (path: string, init?: RequestInit) => Promise<Response> };

beforeAll(
  async () => {
    const { assemble } = await import("../src/assemble.js");
    app = (await assemble()).app;
  },
  COMPOSITION_TIMEOUT,
);

describe("builder trace id containment", () => {
  it(
    "fails the detail route loudly for a traversal id instead of reading outside the traces dir",
    { timeout: COMPOSITION_TIMEOUT },
    async () => {
      // Hono decodes ..%2F back to ../ in the route param. Without the guard
      // this request would 200 while parsing <dataRoot>/escape_read.jsonl.
      const response = await app.request("/api/builder/sessions/..%2Fescape_read");
      expect(response.status).toBe(500);
      // Nothing may appear beside the traces directory either way.
      expect(fs.existsSync(path.join(dataRoot, "escape_read.jsonl"))).toBe(false);
    },
  );

  it(
    "keeps serving detail for a safe hand-crafted id (guard blocks only unsafe ids)",
    { timeout: COMPOSITION_TIMEOUT },
    async () => {
      const response = await app.request("/api/builder/sessions/handcrafted_ok");
      expect(response.status).toBe(200);
      const body = (await response.json()) as { records: unknown[]; truncated: boolean };
      // The journal file was never created: an empty read, not an error.
      expect(body.records).toEqual([]);
      expect(body.truncated).toBe(false);
    },
  );

  it(
    "deletes a traversal-id session without crashing or writing outside the traces dir",
    { timeout: COMPOSITION_TIMEOUT },
    async () => {
      // deleteSession fires the journal cleanup void: the guard's synchronous
      // throw inside it must degrade to a warning (SessionTraceStore.delete),
      // never escape as an unhandled rejection. The warning itself is the
      // assertion: without the degradation the cleanup rejects unobserved and
      // no warning fires.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const response = await app.request("/api/builder/sessions/..%2Fescape_delete", { method: "DELETE" });
      expect(response.status).toBe(200);
      // The voided cleanup runs detached: wait for its logged degradation.
      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("journal clear failed"));
      });
      warn.mockRestore();
      // The store record itself is gone; the journal cleanup failure is logged.
      const detail = await app.request("/api/builder/sessions/..%2Fescape_delete");
      expect(detail.status).toBe(404);
      expect(fs.existsSync(path.join(dataRoot, "escape_delete.jsonl"))).toBe(false);
    },
  );

  afterAll(() => {
    // The stores live in the suite's scratch data dir; discard it wholesale.
    fs.rmSync(dataRoot, { recursive: true, force: true });
    delete process.env.ARENA_DATA_DIR;
  });
});
