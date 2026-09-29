/**
 * @file session-store parity harness
 * @description Shared behavioral suite for the SessionStore backends.
 *
 * Responsibilities:
 * - Lock the mutation semantics both backends promise to keep identical
 *   (caps, sanitization, stale-active migration, newest-first ordering —
 *   see the JsonlSessionStore header)
 *
 * The single-doc and JSONL backends are a deliberate dual implementation that
 * differs only in durability mechanics. That "mirror exactly" invariant was
 * previously maintained by hand with no mechanical guard; this suite runs the
 * same scenarios against whatever backend the caller plugs in, so a semantic
 * change in one store without the other fails here. It intentionally covers
 * only behaviors that are already identical — backend-specific crash recovery
 * keeps its dedicated tests.
 */

import { describe, expect, it } from "vitest";
import type { SessionStore } from "@agentprism/contracts";
import { SessionNotFoundError, SessionValidationError } from "@agentprism/contracts";
import {
  InMemoryBlobStore,
  MAX_ENTRIES_PER_SESSION,
  MAX_SESSIONS_PER_STORE,
  MAX_SESSION_TITLE_CHARS,
  MAX_SUMMARY_CHARS,
} from "@agentprism/session";

/** One backend under test: fresh instances over the SAME backing files. */
export interface SessionStoreBackend {
  /** A store instance over the shared backing files (each open reloads persisted state). */
  open(): SessionStore | Promise<SessionStore>;
  /** Removes the temp files this backend created. */
  dispose(): void;
}

/** Runs the shared semantics suite against one backend factory (one describe block). */
export function runSessionStoreParityTests(family: string, makeBackend: () => SessionStoreBackend): void {
  describe(`${family} (shared SessionStore semantics)`, () => {
    it("round-trips a lifecycle across a reopen", async () => {
      const backend = makeBackend();
      try {
        const first = await backend.open();
        const created = await first.create({ kind: "arena", title: "bash", metadata: { selections: 2 } });
        await first.appendEntry(created.id, { kind: "verdict", content: "column A wins" });
        await first.complete(created.id, { summary: "done", metadata: { winner: "A" } });

        const second = await backend.open();
        expect(await second.get(created.id)).toEqual({
          id: created.id,
          kind: "arena",
          title: "bash",
          status: "completed",
          createdAt: created.createdAt,
          updatedAt: created.createdAt + 2,
          summary: "done",
          metadata: { selections: 2, winner: "A" },
          entryCount: 1,
        });
        expect((await second.listEntries(created.id)).map((entry) => entry.content)).toEqual(["column A wins"]);
        expect(await second.list({ kind: "arena", status: "completed" })).toHaveLength(1);
      } finally {
        backend.dispose();
      }
    });

    it("rejects blank titles and slices overlong ones", async () => {
      const backend = makeBackend();
      try {
        const store = await backend.open();
        await expect(store.create({ kind: "agent", title: "   " })).rejects.toThrow(SessionValidationError);
        const created = await store.create({ kind: "agent", title: "x".repeat(MAX_SESSION_TITLE_CHARS + 10) });
        expect((await store.get(created.id))?.title).toHaveLength(MAX_SESSION_TITLE_CHARS);
      } finally {
        backend.dispose();
      }
    });

    it("rejects creates past the store cap", async () => {
      const backend = makeBackend();
      try {
        const store = await backend.open();
        for (let i = 0; i < MAX_SESSIONS_PER_STORE; i += 1) {
          await store.create({ kind: "agent", title: `s${i}` });
        }
        await expect(store.create({ kind: "agent", title: "overflow" })).rejects.toThrow(SessionValidationError);
      } finally {
        backend.dispose();
      }
    });

    it("marks fail/cancel with trimmed bounded reasons and throws on unknown ids", async () => {
      const backend = makeBackend();
      try {
        const store = await backend.open();
        const failed = await store.create({ kind: "agent", title: "f" });
        await store.fail(failed.id, `  ${"r".repeat(MAX_SUMMARY_CHARS + 10)}  `);
        const failedRecord = await store.get(failed.id);
        expect(failedRecord?.status).toBe("failed");
        expect(failedRecord?.summary).toHaveLength(MAX_SUMMARY_CHARS);

        const cancelled = await store.create({ kind: "agent", title: "c" });
        await store.cancel(cancelled.id);
        expect((await store.get(cancelled.id))?.status).toBe("cancelled");

        await expect(store.complete("missing")).rejects.toThrow(SessionNotFoundError);
        await expect(store.fail("missing", "x")).rejects.toThrow(SessionNotFoundError);
        await expect(store.appendEntry("missing", { kind: "note", content: "x" })).rejects.toThrow(SessionNotFoundError);
        await expect(store.listEntries("missing")).rejects.toThrow(SessionNotFoundError);
      } finally {
        backend.dispose();
      }
    });

    it("rejects empty entries and the per-session entry cap", async () => {
      const backend = makeBackend();
      try {
        const store = await backend.open();
        const created = await store.create({ kind: "agent", title: "entries" });
        await expect(store.appendEntry(created.id, { kind: "note", content: "   " })).rejects.toThrow(
          SessionValidationError,
        );
        for (let i = 0; i < MAX_ENTRIES_PER_SESSION; i += 1) {
          await store.appendEntry(created.id, { kind: "note", content: `e${i}` });
        }
        await expect(store.appendEntry(created.id, { kind: "note", content: "overflow" })).rejects.toThrow(
          SessionValidationError,
        );
      } finally {
        backend.dispose();
      }
    });

    it("spills oversized entries to the blob sidecar and serves them via readBlob", async () => {
      const backend = makeBackend();
      try {
        const store = await backend.open();
        const created = await store.create({ kind: "agent", title: "spill" });
        const oversized = "b".repeat(9_000);
        const stored = await store.appendEntry(created.id, { kind: "note", content: oversized });
        // Inline content is the locator-first preview, not the full body.
        expect(stored.content.length).toBeLessThan(oversized.length);
        // Optional on the port (both backends implement it); absent would read as no blobs.
        const blob = store.readBlob ? await store.readBlob(created.id, stored.seq) : null;
        expect(blob).toBe(oversized);
      } finally {
        backend.dispose();
      }
    });

    it("lists entries and records newest-first with filters and limits", async () => {
      const backend = makeBackend();
      try {
        const store = await backend.open();
        const arena = await store.create({ kind: "arena", title: "arena" });
        const agent = await store.create({ kind: "agent", title: "agent" });
        await store.appendEntry(arena.id, { kind: "note", content: "first" });
        await store.appendEntry(arena.id, { kind: "note", content: "second" });

        expect((await store.listEntries(arena.id)).map((entry) => entry.content)).toEqual(["second", "first"]);
        expect((await store.listEntries(arena.id, 1)).map((entry) => entry.content)).toEqual(["second"]);

        // Newest-created first; the limit slices after the sort.
        expect((await store.list()).map((record) => record.id)).toEqual([agent.id, arena.id]);
        expect((await store.list({ kind: "agent" })).map((record) => record.id)).toEqual([agent.id]);
        expect((await store.list({ status: "active" })).map((record) => record.id)).toEqual([agent.id, arena.id]);
        expect((await store.list({ limit: 1 })).map((record) => record.id)).toEqual([agent.id]);
      } finally {
        backend.dispose();
      }
    });

    it("deletes record plus entries and reports unknown deletes as false", async () => {
      const backend = makeBackend();
      try {
        const store = await backend.open();
        const created = await store.create({ kind: "agent", title: "gone" });
        await store.appendEntry(created.id, { kind: "note", content: "e" });
        expect(await store.delete("missing")).toBe(false);
        expect(await store.delete(created.id)).toBe(true);
        expect(await store.get(created.id)).toBeNull();

        const reopened = await backend.open();
        expect(await reopened.get(created.id)).toBeNull();
        expect(await reopened.list()).toHaveLength(0);
      } finally {
        backend.dispose();
      }
    });

    it("migrates stale active rows to failed on reopen", async () => {
      const backend = makeBackend();
      try {
        const first = await backend.open();
        const created = await first.create({ kind: "builder", title: "hangs" });
        // The live instance keeps its own state; only a reopened instance owns
        // execution state now, so the inherited run lands failed there.
        const second = await backend.open();
        expect((await second.get(created.id))?.status).toBe("failed");
        expect((await second.list({ status: "failed" })).map((record) => record.id)).toEqual([created.id]);
      } finally {
        backend.dispose();
      }
    });
  });
}
