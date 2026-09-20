/**
 * @file project startup recovery tests
 * @description Locks crash-safe startup: corrupt/missing archives and invalid entries never refuse service.
 */

import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@agentprism/contracts";
import type { WorkspaceRegistry } from "@agentprism/runtime";
import { AtomicJsonFile } from "@agentprism/persistence";
import { ProjectStore } from "@agentprism/application";

function makeDeps(filePath: string): { file: AtomicJsonFile; workspaceRegistry: WorkspaceRegistry; clock: Clock; idGenerator: IdGenerator } {
  return {
    file: new AtomicJsonFile(filePath),
    workspaceRegistry: { get: () => undefined } as unknown as WorkspaceRegistry,
    clock: { now: () => 1_700_000_000_000 },
    idGenerator: { next: () => randomUUID() },
  };
}

describe("ProjectStore startup recovery", () => {
  it("starts with an empty store when the archive is corrupt, without refusing service (same fallback as ProviderStore)", () => {
    const dir = mkdtempSync(join(tmpdir(), "aprism-projects-"));
    const filePath = join(dir, "projects.json");
    writeFileSync(filePath, '{"projects": [truncated half JSON', "utf8");

    const store = new ProjectStore({ ...makeDeps(filePath) });
    expect(store.listProjects()).toEqual([]);
  });

  it("starts with an empty store when the archive file is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "aprism-projects-"));
    const store = new ProjectStore(makeDeps(join(dir, `missing-${randomUUID()}.json`)));
    expect(store.listProjects()).toEqual([]);
  });

  it("skips schema-invalid archive entries on load instead of refusing service", () => {
    const dir = mkdtempSync(join(tmpdir(), "aprism-projects-"));
    const filePath = join(dir, "projects.json");
    const valid = {
      id: "proj_kept",
      name: "kept",
      question: "q",
      dimension: "d",
      created_at: "2026-01-01T00:00:00.000Z",
      results: [],
      workspace_files: {},
      metrics_summary: {},
    };
    writeFileSync(filePath, JSON.stringify([valid, { id: 123 }, "garbage", null]), "utf8");

    const store = new ProjectStore({ ...makeDeps(filePath) });
    expect(store.listProjects().map((p) => p.id)).toEqual(["proj_kept"]);
  });
});
