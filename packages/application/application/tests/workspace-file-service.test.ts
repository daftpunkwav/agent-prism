/**
 * @file workspace file service tests
 * @description Locks file use cases: list/read/write/delete and not-found mapping.
 */

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceRegistry } from "@agentprism/runtime";
import { AppError } from "@agentprism/application";
import { WorkspaceFileService } from "@agentprism/application";

function setup() {
  const runsRoot = join(tmpdir(), `aprism-ws-svc-${randomUUID()}`);
  const clock = { now: () => 0 };
  const registry = new WorkspaceRegistry({ runsRoot, clock });
  const workspace = registry.create("ws1");
  return {
    runsRoot,
    service: new WorkspaceFileService({ workspaceRegistry: registry }),
    cleanup: () => rmSync(runsRoot, { recursive: true, force: true }),
    seed: () => workspace.fs.writeFile("a.txt", "hello"),
  };
}

describe("WorkspaceFileService", () => {
  it("lists files of a workspace", () => {
    const { service, cleanup, seed } = setup();
    try {
      seed();
      const listed = service.listFiles("ws1");
      expect(listed.workspace).toBe("ws1");
      expect(listed.files.map((file) => file.path)).toContain("a.txt");
    } finally {
      cleanup();
    }
  });

  it("reads file content", () => {
    const { service, cleanup, seed } = setup();
    try {
      seed();
      expect(service.readFile("ws1", "a.txt")).toEqual({ path: "a.txt", content: "hello" });
    } finally {
      cleanup();
    }
  });

  it("writes and deletes files", () => {
    const { service, cleanup } = setup();
    try {
      service.writeFile("ws1", { path: "b.txt", content: "x", create_only: false });
      expect(service.readFile("ws1", "b.txt").content).toBe("x");
      service.deleteFile("ws1", "b.txt");
      expect(service.listFiles("ws1").files.map((file) => file.path)).not.toContain("b.txt");
    } finally {
      cleanup();
    }
  });

  it("maps missing workspaces to 404", () => {
    const { service, cleanup } = setup();
    try {
      try {
        service.listFiles("ghost");
        expect.unreachable("expected a 404 AppError");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).status).toBe(404);
      }
    } finally {
      cleanup();
    }
  });

  it("maps WorkspaceError from reads to 404 and from writes/deletes to 400", () => {
    const { service, cleanup } = setup();
    try {
      // Missing file read: environment raises WorkspaceError → AppError.notFound.
      try {
        service.readFile("ws1", "ghost.txt");
        expect.unreachable("expected a 404 AppError");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).status).toBe(404);
      }
      // create_only on an existing file: WorkspaceError → badRequest.
      service.writeFile("ws1", { path: "c.txt", content: "x", create_only: true });
      try {
        service.writeFile("ws1", { path: "c.txt", content: "y", create_only: true });
        expect.unreachable("expected a 400 AppError");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).status).toBe(400);
      }
      // Deleting a missing file maps through the same badRequest translation.
      try {
        service.deleteFile("ws1", "ghost.txt");
        expect.unreachable("expected a 400 AppError");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).status).toBe(400);
      }
    } finally {
      cleanup();
    }
  });
});
