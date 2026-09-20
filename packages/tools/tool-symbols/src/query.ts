/**
 * @file tool-symbols/query
 * @description Symbol search, reference search, and dependent lookup.
 *
 * Responsibilities:
 * - Exact/prefix/substring symbol search over an index
 * - Word-boundary reference search over file texts
 * - Reverse-dependency lookup via import statements
 *
 * Pure over caller-supplied indexes and texts: the tool layer loads files,
 * this module only ranks. Deterministic ordering throughout (score, then
 * path, then line) so agent transcripts stay reproducible.
 */

import type { SymbolDef } from "./index-symbols.js";

/** Max results per query (bounded context). */
export const SYMBOL_RESULT_LIMIT = 50;

export interface SymbolHit {
  def: SymbolDef;
  score: number;
}

function scoreName(query: string, name: string): number {
  const q = query.toLowerCase();
  const target = name.toLowerCase();
  if (target === q) return 100;
  if (target.startsWith(q)) return 80;
  if (target.includes(q)) return 50;
  let qi = 0;
  for (const char of target) {
    if (char === q[qi]) qi += 1;
    if (qi >= q.length) break;
  }
  return qi / q.length >= 0.6 ? 20 : 0;
}

/**
 * Searches symbol definitions (empty query matches nothing).
 * Ties break by shorter name, then file, then line.
 */
export function searchSymbols(defs: readonly SymbolDef[], query: string, limit: number = SYMBOL_RESULT_LIMIT): SymbolHit[] {
  if (query.trim() === "") return [];
  const hits: SymbolHit[] = [];
  for (const def of defs) {
    const score = scoreName(query, def.name);
    if (score > 0) hits.push({ def, score });
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      a.def.name.length - b.def.name.length ||
      (a.def.file < b.def.file ? -1 : 1) ||
      a.def.line - b.def.line,
  );
  return hits.slice(0, Math.max(1, limit));
}

/** One reference occurrence. */
export interface ReferenceHit {
  file: string;
  line: number;
  preview: string;
}

/**
 * Finds word-boundary references to a symbol across file texts.
 * Definition lines themselves are included (callers filter by line when needed).
 */
export function findReferences(
  files: ReadonlyArray<{ path: string; text: string }>,
  name: string,
  limit: number = SYMBOL_RESULT_LIMIT,
): ReferenceHit[] {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return [];
  const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const out: ReferenceHit[] = [];
  for (const file of files) {
    const lines = file.text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] as string;
      if (!pattern.test(line)) continue;
      out.push({ file: file.path, line: i + 1, preview: line.trim().slice(0, 160) });
      if (out.length >= Math.max(1, limit)) return out;
    }
  }
  return out;
}

/**
 * Finds files importing a module path (reverse dependencies).
 * Matches `from "x"`, `import "x"`, `require("x")`, `use x::`, and bare
 * path mentions; scoped to indexable source files.
 */
export function findDependents(files: ReadonlyArray<{ path: string; text: string }>, modulePath: string): string[] {
  const needle = modulePath.trim().replace(/^\.\//, "");
  if (needle === "") return [];
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(from\\s+["']${escaped}["']|import\\s+["']${escaped}["']|require\\(\\s*["']${escaped}["']\\s*\\)|use\\s+${escaped}|["']@agentprism\\/${escaped}["'])`);
  const out: string[] = [];
  for (const file of files) {
    if (file.path.endsWith(needle) || file.path.endsWith(`/${needle}`)) continue;
    pattern.lastIndex = 0;
    if (pattern.test(file.text)) out.push(file.path);
  }
  return [...new Set(out)].sort();
}
