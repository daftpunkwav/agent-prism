/**
 * @file tools/workspace-view
 * @description Concrete workspace view narrowing ToolWorkspace.fs to ScopedFileSystem.
 *
 * Responsibilities:
 * - Give tool handlers typed filesystem access
 * - Normalize caller-supplied base directories ("." means the workspace root)
 */

import type { ScopedFileSystem } from "@agentprism/environment";
import type { ToolWorkspace } from "@agentprism/contracts";

/** Workspace shape required by builtin tool handlers. */
export interface WorkspaceView {
  name: string;
  root: string;
  cwd(): string;
  fs: ScopedFileSystem;
}

/** Shallow-checks fs is an object then casts; throws TypeError if missing. */
export function asWorkspaceView(workspace: ToolWorkspace): WorkspaceView {
  const fs = workspace.fs;
  if (fs === null || typeof fs !== "object") {
    throw new TypeError("ToolWorkspace.fs must be a ScopedFileSystem");
  }
  return workspace as WorkspaceView;
}

/**
 * Normalizes a base-directory arg for the scoped filesystem: "." and "./" mean the
 * workspace root. The scoped filesystem treats "" as the root while "." canonicalizes
 * to null and list operations return nothing, so an unnormalized "." would make
 * ls/glob/grep silently act on an empty directory and report "no matches" instead of
 * the workspace verdict the model asked for.
 */
export function normalizeBasePath(raw: unknown): string {
  const path = typeof raw === "string" ? raw.trim() : "";
  return path === "." || path === "./" ? "" : path;
}
