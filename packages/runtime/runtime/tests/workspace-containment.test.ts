/**
 * @file workspace containment tests
 * @description Locks the runs-root containment guard: traversal, root-targeting,
 * and (on Windows) case-variant spellings must resolve inside the runs root.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceRegistry } from "@agentprism/runtime";

function freshRegistry(runsRoot: string): WorkspaceRegistry {
  return new WorkspaceRegistry({
    runsRoot,
    clock: { now: () => 1_700_000_000_000 },
  });
}

function withRunsRoot(run: (runsRoot: string) => void): void {
  const runsRoot = join(tmpdir(), `aprism-contain-${randomUUID()}`);
  mkdirSync(runsRoot, { recursive: true });
  try {
    run(runsRoot);
  } finally {
    rmSync(runsRoot, { recursive: true, force: true });
  }
}

describe("WorkspaceRegistry runs-root containment", () => {
  it("rejects a workspace name that traverses out of the runs root", () => {
    withRunsRoot((runsRoot) => {
      const registry = freshRegistry(runsRoot);
      // "../.." climbs past the runId level AND past the runs root itself.
      expect(() => registry.create("../../escaped", "run-1")).toThrow(/escapes runs root/);
      expect(() => registry.create("ws/../../../escaped", "run-1")).toThrow(/escapes runs root/);
    });
  });

  it("rejects a runId that traverses out of the runs root", () => {
    withRunsRoot((runsRoot) => {
      const registry = freshRegistry(runsRoot);
      expect(() => registry.create("ws", "../run-escape")).toThrow(/escapes runs root/);
      expect(() => registry.create("ws", "../../run-escape")).toThrow(/escapes runs root/);
    });
  });

  it("rejects a name+runId pair that targets the runs root itself", () => {
    withRunsRoot((runsRoot) => {
      const registry = freshRegistry(runsRoot);
      // A workspace directory must sit strictly inside the runs root; "."
      // segments collapse onto the root, which is an escape like any other.
      expect(() => registry.create(".", ".")).toThrow(/escapes runs root/);
    });
  });

  it("keeps legitimate names inside the runs root", () => {
    withRunsRoot((runsRoot) => {
      const registry = freshRegistry(runsRoot);
      const workspace = registry.create("demo_ws-1", "run-1");
      expect(workspace.root.startsWith(runsRoot)).toBe(true);
      expect(registry.runIdOf("demo_ws-1")).toBe("run-1");
    });
  });

  it("rejects a sibling-directory spelling next to the runs root", () => {
    withRunsRoot((runsRoot) => {
      const registry = freshRegistry(runsRoot);
      // A real sibling (different name, same parent) must never pass, whatever
      // spelling climbs to it.
      expect(() => registry.create(`../../x-${randomUUID()}`, "run-1")).toThrow(/escapes runs root/);
    });
  });

  it(
    "accepts a case-variant spelling of a workspace inside the runs root (win32)",
    { skip: process.platform !== "win32" },
    () => {
      withRunsRoot((runsRoot) => {
        const registry = freshRegistry(runsRoot);
        // "../<UPPER>/ws" climbs above the runs root and re-enters it under a
        // different case: the same physical directory on a case-insensitive
        // filesystem, so the relative containment check must accept it (a raw
        // string-prefix check rejected this shape).
        const upper = basename(runsRoot).toUpperCase();
        const workspace = registry.create(`../../${upper}/ws`, "run-1");
        expect(resolve(workspace.root).toLowerCase()).toBe(join(runsRoot, "ws").toLowerCase());
      });
    },
  );
});
