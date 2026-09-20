/**
 * @file scoped-filesystem
 * @description Root-scoped filesystem primitives against traversal and symlink escapes.
 *
 * Responsibilities:
 * - Canonicalize every path to stay inside the root
 * - Check symlink escapes on read/write/delete/list paths
 * - Fail closed with WorkspaceError on read/write/delete violations; list operations return [] on violation.
 */

import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { estimateTokensFromChars } from "@agentprism/contracts";

/** Workspace/directory operation error. */
export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Basic filesystem capabilities bounded by a root directory.
 * All paths go through canonicalize first to stay inside the root (directory
 * traversal defense); illegal or escaping paths return null.
 */
export class ScopedFileSystem {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Canonicalizes a relative path into the root; returns null for illegal or escaping paths. */
  canonicalize(rawPath: string): string | null {
    if (typeof rawPath !== "string") return null;
    let candidate = rawPath.trim().replaceAll("\\", "/");
    if (candidate === "" || candidate.startsWith("/") || CONTROL_CHARS.test(candidate)) return null;
    // Manually normalize the posix-style path, resolving "." / ".." segments
    const stack: string[] = [];
    for (const segment of candidate.split("/")) {
      if (segment === "" || segment === ".") continue;
      if (segment === "..") {
        // Escaping the root: reject outright rather than silently rewriting into the root.
        if (stack.length === 0) return null;
        stack.pop();
        continue;
      }
      stack.push(segment);
    }
    candidate = stack.join("/");
    if (candidate === "" || candidate === ".." || candidate.startsWith("../")) return null;
    if (candidate.split("/").some((segment) => WIN_RESERVED.test(segment)) || /^\.+$/.test(candidate)) return null;
    const target = path.resolve(this.root, candidate);
    const resolvedRoot = path.resolve(this.root);
    if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) return null;
    return target;
  }

  /** Whether a file exists inside the workspace. False for escaping or missing paths. */
  exists(filePath: string): boolean {
    const target = this.canonicalize(filePath);
    if (target === null) return false;
    try {
      statSync(target);
      return true;
    } catch {
      return false;
    }
  }

  /** Asserts the target and its parents stay inside the root after symlink resolution; missing paths skip the corresponding checks. */
  private assertWithinRootThroughLinks(target: string): void {
    const resolvedRoot = path.resolve(this.root);
    if (target === resolvedRoot) return; // the root itself needs no check (its parent is necessarily outside)
    const within = (candidate: string): boolean =>
      candidate === resolvedRoot || candidate.startsWith(resolvedRoot + path.sep);
    // A dangling symlink throws ENOENT on realpath yet still redirects later writes outside the root: lstat sees it, reject outright
    try {
      if (lstatSync(target).isSymbolicLink()) {
        throw new WorkspaceError(`Error: path escapes root (symlink): ${target}`);
      }
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      // Target missing and not a link: handled by realpath and the actual operation below
    }
    let parentAsserted = false;
    try {
      if (!within(realpathSync(path.dirname(target)))) {
        throw new WorkspaceError(`Error: path escapes root (symlink): ${target}`);
      }
      parentAsserted = true;
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      // Parent does not exist yet: asserting only the direct parent is not enough — link
      // ancestors may hide under missing intermediate segments, and mkdirSync(recursive)
      // resolves through them outside the root, so the deepest existing ancestor must be checked.
    }
    if (!parentAsserted) this.assertAncestorChainWithinRoot(target, within);
    try {
      if (!within(realpathSync(target))) {
        throw new WorkspaceError(`Error: path escapes root (symlink): ${target}`);
      }
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      // Target does not exist yet: the parent has been verified.
    }
  }

  /** When multi-level parents of the target do not exist, walks up to the deepest existing ancestor and asserts it is inside the root. */
  private assertAncestorChainWithinRoot(
    target: string,
    within: (candidate: string) => boolean,
  ): void {
    let dir = path.dirname(target);
    for (;;) {
      try {
        if (!within(realpathSync(dir))) {
          throw new WorkspaceError(`Error: path escapes root (symlink): ${target}`);
        }
        // The deepest existing ancestor is inside the root: segments created below it cannot pass through any link
        return;
      } catch (error) {
        if (error instanceof WorkspaceError) throw error;
        // An ENOENT segment that is itself a dangling symlink (realpath throws ENOENT but lstat
        // sees it) redirects writes below it outside the root — it must not be skipped as a
        // "missing intermediate segment" (defense in depth; do not rely on downstream
        // mkdirSync's coincidental error semantics for dangling segments)
        try {
          if (lstatSync(dir).isSymbolicLink()) {
            throw new WorkspaceError(`Error: path escapes root (symlink): ${target}`);
          }
        } catch (lstatError) {
          if (lstatError instanceof WorkspaceError) throw lstatError;
          // The segment really does not exist: walk up one level
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
          // Reached the filesystem root with nothing existing (extreme race): let it through; the actual file operation will error
          return;
        }
        dir = parent;
      }
    }
  }

  /** Real path used on the read side: resolves symlinks before reading, narrowing the check-to-use window. */
  private safeReadPath(target: string): string {
    this.assertWithinRootThroughLinks(target);
    try {
      return realpathSync(target);
    } catch {
      return target;
    }
  }

  /** Lists file relative paths; recursive walks the whole tree, otherwise only direct child files. Illegal directories return []. */
  listFiles(dirPath = "", options: { recursive?: boolean } = {}): string[] {
    const recursive = options.recursive ?? false;
    const base = dirPath === "" ? this.root : this.canonicalize(dirPath);
    if (base === null) return [];
    // Refuse listing when the base itself is a symlink (prevents leaking outside-root structure; directory loops/escapes are also caught by the assert)
    try {
      this.assertWithinRootThroughLinks(base);
    } catch {
      return [];
    }
    let baseStat;
    try {
      baseStat = statSync(base);
    } catch {
      return [];
    }
    if (!baseStat.isDirectory()) return [];
    const results: string[] = [];
    if (recursive) {
      const walk = (dir: string, depth: number) => {
        if (depth > 32) return; // guards against directory loops and abnormally deep trees
        let entries: string[];
        try {
          entries = readdirSync(dir).sort();
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = path.join(dir, entry);
          let stat;
          try {
            stat = lstatSync(full);
          } catch {
            continue;
          }
          if (stat.isSymbolicLink()) continue; // never follow symlinks: guards against loops and outside-root listing
          if (stat.isDirectory()) {
            walk(full, depth + 1);
          } else {
            const rel = path.relative(this.root, full).replaceAll("\\", "/");
            if (!rel.endsWith(".gitkeep")) results.push(rel);
          }
        }
      };
      walk(base, 0);
      results.sort();
      return results;
    }
    // Same guard as the recursive branch: the directory may vanish between statSync and readdirSync.
    let entries: string[];
    try {
      entries = readdirSync(base).sort();
    } catch {
      return [];
    }
    for (const entry of entries) {
      const full = path.join(base, entry);
      let stat;
      try {
        stat = lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue; // never follow symlinks: guards against outside-root listing
      if (stat.isFile() && entry !== ".gitkeep") {
        results.push(path.relative(this.root, full).replaceAll("\\", "/"));
      }
    }
    return results;
  }

  /** Lists file relative paths with byte sizes (whole tree). */
  listFileEntries(): Array<{ path: string; size: number }> {
    const entries: Array<{ path: string; size: number }> = [];
    for (const rel of this.listFiles("", { recursive: true })) {
      try {
        const stat = statSync(path.join(this.root, rel));
        entries.push({ path: rel, size: stat.size });
      } catch {
        continue;
      }
    }
    return entries;
  }

  readFile(filePath: string): string {
    const target = this.canonicalize(filePath);
    if (target === null) throw new WorkspaceError(`Error: file not found: ${filePath}`);
    const real = this.safeReadPath(target);
    try {
      return readFileSync(real, "utf-8");
    } catch {
      throw new WorkspaceError(`Error: file not found: ${filePath}`);
    }
  }

  writeFile(filePath: string, content: string): string {
    const target = this.canonicalize(filePath);
    if (target === null) throw new WorkspaceError("Error: invalid file path");
    this.assertWithinRootThroughLinks(target);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, "utf-8");
    // Char-proxy token estimate (contracts single source), not bytes: the model and the
    // trace UI both reason in tokens, and char counts invite wrong-budget conclusions.
    return `Wrote: ${filePath} (~${estimateTokensFromChars(content.length)} tokens)`;
  }

  createFile(filePath: string, content = ""): string {
    const target = this.canonicalize(filePath);
    if (target === null) throw new WorkspaceError("Error: invalid file path");
    if (exists(target)) throw new WorkspaceError(`Error: file already exists: ${filePath}`);
    return this.writeFile(filePath, content);
  }

  editFile(filePath: string, oldText: string, newText: string): string {
    const target = this.canonicalize(filePath);
    if (target === null) throw new WorkspaceError(`Error: file not found: ${filePath}`);
    // Empty oldText matches everywhere (String.includes("")): without this guard an empty
    // replacement silently prepends instead of replacing, corrupting the file.
    if (oldText === "") throw new WorkspaceError("Error: old_text must not be empty");
    const real = this.safeReadPath(target);
    let current: string;
    try {
      current = readFileSync(real, "utf-8");
    } catch {
      throw new WorkspaceError(`Error: file not found: ${filePath}`);
    }
    if (!current.includes(oldText)) {
      throw new WorkspaceError(`Error: text to replace not found: ${oldText.slice(0, 80)}`);
    }
    this.assertWithinRootThroughLinks(target);
    writeFileSync(target, current.replace(oldText, newText), "utf-8");
    return `Edited: ${filePath}`;
  }

  deleteFile(filePath: string): string {
    const target = this.canonicalize(filePath);
    if (target === null) throw new WorkspaceError(`Error: file not found: ${filePath}`);
    // The same symlink assertion as read/write/edit: when a parent contains link segments, unlink would resolve through them outside the root
    this.assertWithinRootThroughLinks(target);
    try {
      unlinkSync(target);
    } catch {
      throw new WorkspaceError(`Error: file not found: ${filePath}`);
    }
    return `Deleted: ${filePath}`;
  }

  /** Text view of the file tree (recursive). */
  fileTree(name: string): string {
    const files = this.listFiles("", { recursive: true });
    if (files.length === 0) return "(empty)";
    const lines: string[] = [`📁 ${name}/`];
    for (const rel of files) {
      let size = 0;
      try {
        size = statSync(path.join(this.root, rel)).size;
      } catch {
        size = 0;
      }
      lines.push(`  📄 ${rel} (${size} bytes)`);
    }
    return lines.join("\n");
  }

  /**
   * Exports file contents (for project save snapshots). Reads files asynchronously
   * one by one to avoid blocking the event loop on large snapshots.
   * The total budget is enforced during the walk (not after): oversized workspaces
   * stop early instead of materializing fully in memory first.
   */
  async snapshotFiles(options: { maxTotalChars?: number } = {}): Promise<Record<string, string>> {
    const budget = options.maxTotalChars ?? Number.POSITIVE_INFINITY;
    const out: Record<string, string> = {};
    let total = 0;
    for (const rel of this.listFiles("", { recursive: true })) {
      try {
        // Same validation path as readFile (symlink escape defense); only the content read is async
        const target = this.canonicalize(rel);
        if (target === null) continue;
        // Size precheck: skip reading a file that cannot fit the remaining budget.
        // statSync may race with concurrent writers; the post-read length check below is the enforcement.
        try {
          if (total + statSync(path.join(this.root, rel)).size > budget) break;
        } catch {
          // Stat failed (vanished mid-walk): fall through to the read attempt below.
        }
        const content = await readFile(this.safeReadPath(target), "utf-8");
        if (total + content.length > budget) break;
        total += content.length;
        out[rel] = content;
      } catch {
        // Skip individual file read failures
      }
    }
    return out;
  }
}

function exists(target: string): boolean {
  try {
    statSync(target);
    return true;
  } catch {
    return false;
  }
}
