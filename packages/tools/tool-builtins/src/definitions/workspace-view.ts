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
 * Normalizes a base-directory arg for the scoped filesystem. "" means the workspace
 * root; "." and its relative spellings ("./", ".\\", "./src", "src/.") collapse to
 * their canonical relative form.
 *
 * The scoped filesystem resolves "."/".."/separators internally, but the glob tool
 * also compares the base as a literal string prefix, so the spelling must be canonical
 * BEFORE the walk or base-relative patterns silently match nothing. ".." and absolute
 * values are deliberately kept as-is: the scoped filesystem rejects them, closing the
 * containment boundary downstream.
 */
export function normalizeBasePath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // Backslashes are path separators for the models this host serves (Windows), and the
  // scoped filesystem already converts them; do it before any prefix comparison.
  let path = raw.trim().replaceAll("\\", "/");
  const absolute = path.startsWith("/");
  path = path.replace(/\/{2,}/g, "/");
  // Repeated current-directory prefixes are noise ("." , "./", "././src").
  while (path.startsWith("./")) path = path.slice(2);
  // Trailing separators and a trailing dot segment name the same directory ("src/",
  // "src/."). Loop linearly: unanchored `/\/+$/` backtracking degrades quadratically.
  for (;;) {
    if (path === "/") break; // keep the absolute marker for the containment check
    if (path.endsWith("/")) {
      path = path.slice(0, -1);
      continue;
    }
    if (path.endsWith("/.")) {
      path = path.slice(0, -2);
      continue;
    }
    break;
  }
  if (path === ".") return "";
  // Preserve absoluteness even when stripping reduced the value to empty ("/", "/."):
  // returning "" would silently expose the workspace root for an absolute arg.
  if (path === "") return absolute ? "/" : "";
  return path;
}
