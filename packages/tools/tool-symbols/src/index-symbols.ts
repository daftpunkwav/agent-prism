/**
 * @file tool-symbols/index-symbols
 * @description Workspace symbol indexing: definitions with line numbers.
 *
 * Responsibilities:
 * - Extract definitions (function/class/interface/struct/enum/trait/arrow-const)
 * - Record file, line, column, and enclosing scope per symbol
 * - Stay total over broken files (heuristics, never parse-or-die)
 *
 * Regex heuristics over tree-sitter by design: zero dependencies,
 * deterministic output, and graceful degradation on syntactically broken
 * files (exactly the files agents most often need to navigate).
 */

export type SymbolKind = "function" | "class" | "interface" | "struct" | "enum" | "const";

/** One indexed definition. */
export interface SymbolDef {
  name: string;
  kind: SymbolKind;
  file: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column of the name start. */
  column: number;
  /** Enclosing scope path (`Outer > inner`), empty for top level. */
  scope: string;
}

/** Indexable source extensions. */
export const SYMBOL_EXTENSIONS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs",
  "py", "go", "rs", "java", "kt", "rb", "php", "swift",
  "c", "h", "cpp", "hpp", "cs", "scala",
]);

const PATTERNS: Array<{ kind: SymbolKind; pattern: RegExp }> = [
  { kind: "class", pattern: /^(?:export\s+|abstract\s+)*(?:class|interface|struct|enum|trait)\s+([A-Za-z_$][\w$]*)/ },
  { kind: "function", pattern: /^(?:export\s+|async\s+|public\s+|private\s+|protected\s+|static\s+|def\s+|function\s+|fn\s+|func\s+)*\b(?:def|function|fn|func)\s+([A-Za-z_$][\w$]*)/ },
  { kind: "function", pattern: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/ },
  { kind: "function", pattern: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/ },
  { kind: "const", pattern: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/ },
  { kind: "function", pattern: /^\s*([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?::\s*[^{};]+)?\{?\s*$/ },
];

/** Control keywords that look like calls but never define symbols. */
const NON_DEFINITIONS = new Set([
  "if", "for", "while", "switch", "catch", "with", "return", "throw", "import", "export", "new", "delete", "typeof",
]);

function indentOf(line: string): number {
  const match = /^(\s*)/.exec(line);
  if (match === null) return 0;
  return (match[1] ?? "").replace(/\t/g, "  ").length;
}

function extensionOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

/** Whether a path is indexable source (extension allowlist). */
export function isIndexable(path: string): boolean {
  return SYMBOL_EXTENSIONS.has(extensionOf(path));
}

/**
 * Extracts definitions from one file's text (never throws on broken input).
 * Scope tracks indentation-nested class/function containers.
 */
export function indexFile(path: string, text: string): SymbolDef[] {
  if (!isIndexable(path)) return [];
  const out: SymbolDef[] = [];
  const stack: Array<{ name: string; indent: number }> = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) continue;
    const indent = indentOf(line);
    while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? 0) >= indent) stack.pop();
    for (const { kind, pattern } of PATTERNS) {
      const match = pattern.exec(line);
      if (match === null) continue;
      const name = match[1];
      if (name === undefined || NON_DEFINITIONS.has(name)) continue;
      const column = (match.index ?? 0) + match[0].indexOf(name) + 1;
      out.push({ name, kind, file: path, line: i + 1, column, scope: stack.map((entry) => entry.name).join(" > ") });
      if (kind === "class" || kind === "function") stack.push({ name, indent });
      break;
    }
  }
  return out;
}

/**
 * Indexes many files into one definition list (sorted by file, then line).
 * Per-file failures are impossible by construction (indexFile is total).
 */
export function indexFiles(files: ReadonlyArray<{ path: string; text: string }>): SymbolDef[] {
  const out: SymbolDef[] = [];
  for (const file of files) out.push(...indexFile(file.path, file.text));
  return out.sort((a, b) => (a.file < b.file ? -1 : 1) || a.line - b.line);
}
