/**
 * @file project archive creation tests
 * @description Locks archive content: display labels, fallback labels, and file snapshots.
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

describe("ProjectStore archive creation", () => {
  function registryWithFiles(files: Record<string, string>) {
    return {
      get: (name: string) =>
        name.startsWith("ws") ? { fs: { snapshotFiles: async () => files } } : undefined,
    } as unknown as WorkspaceRegistry;
  }

  it("stores the pipeline display label, not the workspace disk name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aprism-projects-"));
    const store = new ProjectStore({
      ...makeDeps(join(dir, "projects.json")),
      workspaceRegistry: registryWithFiles({ "a.txt": "hi" }),
    });
    const project = await store.createFromRun({
      name: "p",
      question: "q",
      dimension: "d",
      pipeline_labels: ["native-react"],
      workspace_names: ["ws1"],
    });
    expect(project.results).toHaveLength(1);
    expect(project.results[0]).toMatchObject({ label: "native-react", workspace: "ws1" });
    expect(project.workspace_files["ws1"]).toEqual({ "a.txt": "hi" });
  });

  it("falls back to the workspace name when pipeline_labels is shorter", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aprism-projects-"));
    const store = new ProjectStore({
      ...makeDeps(join(dir, "projects.json")),
      workspaceRegistry: registryWithFiles({ "a.txt": "hi" }),
    });
    const project = await store.createFromRun({
      name: "p",
      question: "q",
      dimension: "d",
      pipeline_labels: ["only-one"],
      workspace_names: ["ws1", "ws-second"],
    });
    expect(project.results).toHaveLength(2);
    expect(project.results[0]).toMatchObject({ label: "only-one", workspace: "ws1" });
    expect(project.results[1]).toMatchObject({ label: "ws-second", workspace: "ws-second" });
  });

});
