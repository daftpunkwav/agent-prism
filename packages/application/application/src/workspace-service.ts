/**
 * @file workspace-service
 * @description Workspace file use cases: list, read, write, delete.
 *
 * Responsibilities:
 * - Route file operations through the environment layer's scoped primitives
 *
 * Path safety (traversal/symlink) is guaranteed by the environment layer, not here.
 */

import type { WorkspaceFileEntry } from "@agentprism/contracts";
import { WorkspaceError } from "@agentprism/environment";
import type { WorkspaceRegistry } from "@agentprism/runtime";
import { AppError } from "./errors.js";

export interface WorkspaceFileServiceDeps {
  workspaceRegistry: WorkspaceRegistry;
}

function requireWorkspace(deps: WorkspaceFileServiceDeps, name: string) {
  const workspace = deps.workspaceRegistry.get(name);
  if (workspace === undefined) {
    throw AppError.notFound("Workspace not found");
  }
  return workspace;
}

function toBadRequest(error: unknown): never {
  if (error instanceof WorkspaceError) {
    throw AppError.badRequest(error.message);
  }
  throw error as Error;
}

/** Workspace file use cases: list / read / write / delete (path safety guaranteed by the environment layer). */
export class WorkspaceFileService {
  private readonly deps: WorkspaceFileServiceDeps;

  constructor(deps: WorkspaceFileServiceDeps) {
    this.deps = deps;
  }

  listFiles(workspaceName: string): { workspace: string; files: WorkspaceFileEntry[] } {
    const workspace = requireWorkspace(this.deps, workspaceName);
    return {
      workspace: workspaceName,
      files: workspace.fs.listFileEntries(),
    };
  }

  readFile(workspaceName: string, path: string): { path: string; content: string } {
    const workspace = requireWorkspace(this.deps, workspaceName);
    try {
      return { path, content: workspace.fs.readFile(path) };
    } catch (error) {
      if (error instanceof WorkspaceError) {
        throw AppError.notFound(error.message);
      }
      throw error;
    }
  }

  writeFile(
    workspaceName: string,
    body: { path: string; content: string; create_only: boolean },
  ): { path: string; message: string } {
    const workspace = requireWorkspace(this.deps, workspaceName);
    try {
      const message = body.create_only
        ? workspace.fs.createFile(body.path, body.content)
        : workspace.fs.writeFile(body.path, body.content);
      return { path: body.path, message };
    } catch (error) {
      toBadRequest(error);
    }
  }

  deleteFile(workspaceName: string, path: string): { path: string; message: string } {
    const workspace = requireWorkspace(this.deps, workspaceName);
    try {
      return { path, message: workspace.fs.deleteFile(path) };
    } catch (error) {
      toBadRequest(error);
    }
  }
}
