/**
 * @file tool-symbols/tool
 * @description Read-only `symbols` tool definition over workspace files.
 *
 * Responsibilities:
 * - Expose defs/refs/search/dependents actions with bounded output
 * - Load candidate files through the structural workspace filesystem
 *
 * Read-only: safe in every toolset. Candidate loading caps file count and
 * bytes so a giant workspace cannot blow the context through this tool;
 * caps are loud (counts reported) rather than silent.
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";
import { findDependents, findReferences, searchSymbols } from "./query.js";
import { indexFiles, isIndexable } from "./index-symbols.js";

export const SYMBOLS_TOOL_NAME = "symbols";

export const SYMBOLS_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    action: { type: "string", description: "defs (definitions in a file), refs (references to a symbol), search (find symbols by name), dependents (files importing a module)" },
    path: { type: "string", description: "Workspace-relative file for defs, symbol name for refs/search, module path for dependents" },
    query: { type: "string", description: "Alias for path (either works)" },
  },
  required: ["action"],
  additionalProperties: false,
};

/** Minimal structural filesystem surface (satisfied by the runtime Workspace fs). */
interface StructuralFs {
  readFile(path: string): string;
  listFiles(dir: string, options?: { recursive?: boolean }): string[];
  /** Bounded prefix read; preferred when the host filesystem offers it. */
  readFileHead?(path: string, maxBytes: number): { text: string; truncated: boolean };
  /** Size/mtime listing; used to key the index cache. */
  listFileEntries?(): Array<{ path: string; size: number; mtimeMs: number }>;
}

/** Max files loaded per call. */
export const SYMBOLS_MAX_FILES = 200;
/** Max bytes read per file. */
export const SYMBOLS_MAX_BYTES = 64 * 1024;

function asFs(workspace: ToolWorkspace): StructuralFs | null {
  const fs = workspace.fs as Partial<StructuralFs> | null | undefined;
  if (fs === undefined || fs === null) return null;
  if (typeof fs.readFile !== "function" || typeof fs.listFiles !== "function") return null;
  return fs as StructuralFs;
}

/**
 * Bounded head read: `readFileHead` when the host offers it, otherwise the legacy
 * full read with a post-slice (a host without the primitive cannot be bounded here).
 */
export function readBounded(fs: StructuralFs, path: string, maxBytes: number): string {
  if (typeof fs.readFileHead === "function") return fs.readFileHead(path, maxBytes).text;
  return fs.readFile(path).slice(0, maxBytes);
}

/**
 * Index cache keyed by the workspace filesystem object (WeakMap, so a released
 * workspace releases its index) and invalidated by a fingerprint of the candidate
 * paths with their size and mtime. Rebuilding the whole index on every search made
 * each call O(workspace) work; a stat-only pass is enough to notice an edit.
 */
const INDEX_CACHE = new WeakMap<object, { fingerprint: string; files: Array<{ path: string; text: string }> }>();

function fingerprintOf(fs: StructuralFs, candidates: readonly string[]): string | null {
  if (typeof fs.listFileEntries !== "function") return null;
  let entries: Array<{ path: string; size: number; mtimeMs: number }>;
  try {
    entries = fs.listFileEntries();
  } catch {
    return null;
  }
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  return candidates
    .map((path) => {
      const entry = byPath.get(path);
      return entry === undefined ? `${path}:?` : `${path}:${entry.size}:${entry.mtimeMs}`;
    })
    .join("|");
}

function loadCandidates(fs: StructuralFs): Array<{ path: string; text: string }> {
  let files: string[];
  try {
    // The scoped filesystem treats "" as the root; "." canonicalizes to null and lists nothing.
    files = fs.listFiles("", { recursive: true });
  } catch {
    return [];
  }
  const candidates = files.filter((file) => isIndexable(file)).slice(0, SYMBOLS_MAX_FILES);
  const fingerprint = fingerprintOf(fs, candidates);
  if (fingerprint !== null) {
    const cached = INDEX_CACHE.get(fs as object);
    if (cached !== undefined && cached.fingerprint === fingerprint) return cached.files;
  }
  const out: Array<{ path: string; text: string }> = [];
  for (const path of candidates) {
    try {
      out.push({ path, text: readBounded(fs, path, SYMBOLS_MAX_BYTES) });
    } catch {
      continue;
    }
  }
  if (fingerprint !== null) INDEX_CACHE.set(fs as object, { fingerprint, files: out });
  return out;
}

function target(args: ToolArgs): string {
  const raw = args.path ?? args.query;
  return typeof raw === "string" ? raw.trim() : "";
}

async function executeSymbols(workspace: ToolWorkspace, args: ToolArgs): Promise<ToolExecutionResult> {
  const fs = asFs(workspace);
  if (fs === null) return { result: "Error: workspace filesystem unavailable", fileDiff: null, ok: false, code: "workspace_error" };
  // Action names are case-tolerant so a cased call still binds instead of error-looping.
  const action = String(args.action ?? "").trim().toLowerCase();
  const name = target(args);
  if (action === "defs") {
    if (name === "" || name.includes("..")) {
      return { result: "Error: defs needs a workspace-relative file path", fileDiff: null, ok: false, code: "workspace_error" };
    }
    let text: string;
    try {
      text = readBounded(fs, name, SYMBOLS_MAX_BYTES);
    } catch {
      return { result: `Error: cannot read ${JSON.stringify(name)}`, fileDiff: null, ok: false, code: "workspace_error" };
    }
    const defs = indexFiles([{ path: name, text }]);
    if (defs.length === 0) return { result: `(no symbols in ${name})`, fileDiff: null, ok: true };
    return {
      result: defs.map((def) => `${def.kind} ${def.scope === "" ? "" : `${def.scope} > `}${def.name} (L${def.line})`).join("\n"),
      fileDiff: null,
      ok: true,
    };
  }
  if (action === "search" || action === "refs" || action === "dependents") {
    if (name === "") {
      return { result: `Error: ${action} needs a symbol or module name`, fileDiff: null, ok: false, code: "workspace_error" };
    }
    const candidates = loadCandidates(fs);
    if (action === "search") {
      const hits = searchSymbols(indexFiles(candidates), name).slice(0, 30);
      if (hits.length === 0) return { result: `(no symbols matching ${JSON.stringify(name)})`, fileDiff: null, ok: true };
      return {
        result: hits.map((hit) => `${hit.def.kind} ${hit.def.name} — ${hit.def.file}:L${hit.def.line}`).join("\n"),
        fileDiff: null,
        ok: true,
      };
    }
    if (action === "refs") {
      const hits = findReferences(candidates, name).slice(0, 30);
      if (hits.length === 0) return { result: `(no references to ${JSON.stringify(name)})`, fileDiff: null, ok: true };
      return {
        result: hits.map((hit) => `${hit.file}:L${hit.line}: ${hit.preview}`).join("\n"),
        fileDiff: null,
        ok: true,
      };
    }
    const dependents = findDependents(candidates, name).slice(0, 30);
    if (dependents.length === 0) return { result: `(nothing imports ${JSON.stringify(name)})`, fileDiff: null, ok: true };
    return { result: dependents.join("\n"), fileDiff: null, ok: true };
  }
  return { result: "Error: action must be one of defs, refs, search, dependents", fileDiff: null, ok: false, code: "workspace_error" };
}

/** Read-only symbols tool definition. */
export const symbolsTool: ToolDefinition = {
  name: SYMBOLS_TOOL_NAME,
  description:
    "Navigate code by symbols, not grep: list definitions in a file (defs), find references to a symbol (refs), search symbols by name (search), or find importers of a module (dependents). Read-only.",
  jsonSchema: SYMBOLS_JSON_SCHEMA,
  mutatesWorkspace: false,
  execute: executeSymbols,
};
