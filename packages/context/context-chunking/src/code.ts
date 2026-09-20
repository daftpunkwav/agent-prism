/**
 * @file context-chunking/code
 * @description Code-aware chunking: function/class blocks with signature heads.
 *
 * Responsibilities:
 * - Split source files on top-level and nested definition boundaries
 * - Keep signatures (decorators, docstrings, type headers) with their bodies
 * - Fall back to brace/indentation-agnostic line windows for unknown languages
 *
 * Heuristics over parsers by design: no tree-sitter dependency, deterministic
 * output, and graceful degradation on syntactically broken files (exactly the
 * files agents most often need to read). Offsets are line-based and map back
 * to file line numbers for citations.
 */

export interface CodeChunk {
  content: string;
  /** 1-based start line in the source file. */
  startLine: number;
  /** 1-based end line (inclusive). */
  endLine: number;
  /** Symbol path when determinable (e.g. `class A > method b`), else null. */
  symbol: string | null;
  /** Block kind detected by the splitter. */
  kind: "function" | "class" | "block" | "window";
}

/** Max lines per chunk before a block is windowed. */
export const CODE_MAX_LINES = 120;

/** Overlap lines between consecutive windows of one over-long block. */
export const CODE_OVERLAP_LINES = 15;

/** `def name`, `function name`, `fn name`, `func name`, `name = (...) =>`, `const name =`. */
const FUNCTION_PATTERNS = [
  /^(\s*)(?:export\s+|async\s+|public\s+|private\s+|protected\s+|static\s+)*(?:def|function|fn|func)\s+([A-Za-z_$][\w$]*)/,
  /^(\s*)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
  /^(\s*)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
  /^(\s*)([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*\{?\s*$/,
];

/** `class Name`, `interface Name`, `type Name =`, `struct Name`, `enum Name`, `trait Name`. */
const CLASS_PATTERNS = [
  /^(\s*)(?:export\s+|abstract\s+)*(?:class|interface|struct|enum|trait)\s+([A-Za-z_$][\w$]*)/,
  /^(\s*)type\s+([A-Za-z_$][\w$]*)\s*=/,
];

function indentOf(line: string): number {
  const match = /^(\s*)/.exec(line);
  return (match?.[1] ?? "").replace(/\t/g, "  ").length;
}

interface Block {
  kind: "function" | "class" | "block";
  symbol: string | null;
  startLine: number;
  lines: string[];
}

/** Splits lines into definition blocks by indentation scope. */
function splitBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  let scopeIndent = 0;
  const close = (): void => {
    if (current !== null && current.lines.some((line) => line.trim() !== "")) blocks.push(current);
    current = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const trimmed = line.trim();
    let matched: { kind: "function" | "class"; symbol: string; indent: number } | null = null;
    if (trimmed !== "" && !trimmed.startsWith("//") && !trimmed.startsWith("#") && !trimmed.startsWith("*")) {
      for (const pattern of CLASS_PATTERNS) {
        const m = pattern.exec(line);
        if (m !== null && m[2] !== undefined) {
          matched = { kind: "class", symbol: m[2], indent: indentOf(line) };
          break;
        }
      }
      if (matched === null) {
        for (const pattern of FUNCTION_PATTERNS) {
          const m = pattern.exec(line);
          if (m !== null && m[2] !== undefined) {
            matched = { kind: "function", symbol: m[2], indent: indentOf(line) };
            break;
          }
        }
      }
    }
    if (matched !== null && (current === null || matched.indent <= scopeIndent)) {
      close();
      current = { kind: matched.kind, symbol: matched.symbol, startLine: i + 1, lines: [line] };
      scopeIndent = matched.indent;
      continue;
    }
    if (current === null) {
      current = { kind: "block", symbol: null, startLine: i + 1, lines: [line] };
      scopeIndent = indentOf(line);
      continue;
    }
    // Dedent to (or above) the block header ends the scope, unless the line
    // continues a bracketed expression (call args, collections).
    const open = (line.match(/[[({]/g) ?? []).length;
    const closed = (line.match(/[\])}]/g) ?? []).length;
    if (trimmed !== "" && indentOf(line) <= scopeIndent && open <= closed && matched === null) {
      close();
      current = { kind: "block", symbol: null, startLine: i + 1, lines: [line] };
      scopeIndent = indentOf(line);
      continue;
    }
    current.lines.push(line);
  }
  close();
  return blocks;
}

/** Windows an over-long block into overlapping line chunks. */
function windowBlock(block: Block, maxLines: number, overlap: number, parentSymbol: string | null): CodeChunk[] {
  const symbol = block.symbol !== null && parentSymbol !== null ? `${parentSymbol} > ${block.symbol}` : (block.symbol ?? parentSymbol);
  if (block.lines.length <= maxLines) {
    return [{
      content: block.lines.join("\n"),
      startLine: block.startLine,
      endLine: block.startLine + block.lines.length - 1,
      symbol,
      kind: block.kind,
    }];
  }
  const out: CodeChunk[] = [];
  const step = Math.max(1, maxLines - overlap);
  for (let at = 0; at < block.lines.length; at += step) {
    const slice = block.lines.slice(at, at + maxLines);
    out.push({
      content: slice.join("\n"),
      startLine: block.startLine + at,
      endLine: block.startLine + at + slice.length - 1,
      symbol,
      kind: "window",
    });
    if (at + maxLines >= block.lines.length) break;
  }
  return out;
}

/**
 * Chunks source code into definition blocks (windowed when over-long).
 * `parentSymbol` prefixes nested chunk symbols (e.g. file path or class).
 */
export function chunkCode(
  text: string,
  options: { maxLines?: number; overlapLines?: number; parentSymbol?: string } = {},
): CodeChunk[] {
  const maxLines = Math.max(20, options.maxLines ?? CODE_MAX_LINES);
  const overlap = Math.min(Math.floor(maxLines / 2), Math.max(0, options.overlapLines ?? CODE_OVERLAP_LINES));
  if (text.trim() === "") return [];
  const lines = text.split("\n");
  const out: CodeChunk[] = [];
  for (const block of splitBlocks(lines)) {
    out.push(...windowBlock(block, maxLines, overlap, options.parentSymbol ?? null));
  }
  return out;
}
