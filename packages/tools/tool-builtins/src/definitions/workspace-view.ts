/**
 * @file tools/workspace-view
 * @description Concrete workspace view narrowing ToolWorkspace.fs to ScopedFileSystem.
 *
 * Responsibilities:
 * - Give tool handlers typed filesystem access
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
