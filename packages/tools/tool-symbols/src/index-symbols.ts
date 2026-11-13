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

export type SymbolKind = "function" | "class" | "interface" | "struct" | "enum" | "trait" | "const";

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
  // One pattern per construct: a shared alternative list reported every interface,
  // struct, enum, and trait as a "class", which mislabels the navigation output.
  // Leading whitespace is allowed so indented methods (Python class methods,
  // Rust trait methods) are indexed too, scoped by the indentation stack.
  { kind: "class", pattern: /^\s*(?:export\s+|abstract\s+|declare\s+)*class\s+([A-Za-z_$][\w$]*)/ },
  { kind: "interface", pattern: /^\s*(?:export\s+|declare\s+)*interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: "struct", pattern: /^\s*(?:export\s+|pub\s+|declare\s+)*struct\s+([A-Za-z_$][\w$]*)/ },
  { kind: "enum", pattern: /^\s*(?:export\s+|pub\s+|declare\s+)*enum\s+([A-Za-z_$][\w$]*)/ },
  { kind: "trait", pattern: /^\s*(?:export\s+|pub\s+)*trait\s+([A-Za-z_$][\w$]*)/ },
  { kind: "function", pattern: /^\s*(?:export\s+|async\s+|public\s+|private\s+|protected\s+|static\s+|def\s+|function\s+|fn\s+|func\s+|pub\s+)*\b(?:def|function|fn|func)\s+([A-Za-z_$][\w$]*)/ },
  // Go method declarations carry a receiver between `func` and the name.
  { kind: "function", pattern: /^\s*func\s+\([^)]*\)\s*([A-Za-z_$][\w$]*)/ },
  { kind: "function", pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/ },
  { kind: "function", pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/ },
  { kind: "const", pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/ },
  { kind: "function", pattern: /^\s*([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?::\s*[^{};]+)?\{?\s*$/ },
];

/** Control keywords that look like calls but never define symbols. */
const NON_DEFINITIONS = new Set([
  "if", "for", "while", "switch", "catch", "with", "return", "throw", "import", "export", "new", "delete", "typeof",
]);

/** Drops one leading `<...>` generic-parameter list (nested angles included). */
function skipLeadingGenerics(text: string): string {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("<")) return trimmed;
  let depth = 0;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "<") depth += 1;
    else if (ch === ">") {
      depth -= 1;
      if (depth === 0) return trimmed.slice(i + 1).trimStart();
    }
  }
  return trimmed;
}

/**
 * Resolves the scope frame name for a Rust `impl` line ("impl <Type>"), or null when
 * the line is not an impl block. The block is a scope, not a definition, so it is
 * pushed as a container-only frame: methods inside would otherwise appear top-level
 * (empty scope) now that indented definitions are indexed. Handles `pub impl`, generic
 * parameters, and trait impls (`impl Trait for Type` — the scope names the target
 * type the methods belong to).
 */
function implContainerName(line: string): string | null {
  const head = /^\s*(?:pub\s+)?impl\b/.exec(line);
  if (head === null) return null;
  let rest = skipLeadingGenerics(line.slice(head[0].length)).trimEnd();
  if (rest.endsWith("{")) rest = rest.slice(0, -1).trimEnd();
  if (rest === "") return null;
  const forAt = rest.lastIndexOf(" for ");
  const target = (forAt === -1 ? rest : rest.slice(forAt + " for ".length)).trim();
  // A path-qualified target (crate::module::Type) scopes under its final type segment.
  const lastSegment = target.split("::").pop() ?? "";
  const name = /^[A-Za-z_$][\w$]*/.exec(lastSegment);
  return name === null ? null : `impl ${name[0]}`;
}

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
 * Scope tracks indentation-nested container definitions.
 */
export function indexFile(path: string, text: string): SymbolDef[] {
  if (!isIndexable(path)) return [];
  const out: SymbolDef[] = [];
  const stack: Array<{ name: string; indent: number }> = [];
  const lines = text.split("\n");
  const isRust = extensionOf(path) === "rs";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) continue;
    const indent = indentOf(line);
    while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? 0) >= indent) stack.pop();
    // Container-only frames (Rust impl blocks) scope their members without becoming
    // symbols themselves: no def is emitted for the impl line.
    const container = isRust ? implContainerName(line) : null;
    if (container !== null) {
      stack.push({ name: container, indent });
      continue;
    }
    for (const { kind, pattern } of PATTERNS) {
      const match = pattern.exec(line);
      if (match === null) continue;
      const name = match[1];
      if (name === undefined || NON_DEFINITIONS.has(name)) continue;
      const column = (match.index ?? 0) + match[0].indexOf(name) + 1;
      out.push({ name, kind, file: path, line: i + 1, column, scope: stack.map((entry) => entry.name).join(" > ") });
      // Every construct except a plain value declaration can enclose indented
      // definitions (class/interface/trait methods, nested types).
      if (kind !== "const") stack.push({ name, indent });
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
