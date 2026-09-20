/**
 * @file answer-compare
 * @description Semantic answer comparison across columns: unit alignment, similarity, entity overlap.
 *
 * Responsibilities:
 * - Split answers into comparable units (lines/sentences) and align two answers
 *   via LCS so shared context reads as shared and column-specific claims stand out
 * - Score pairwise similarity on the aligned units
 * - Extract objective entities (paths, commands, URLs, numbers) and report which
 *   are consensus versus column-exclusive
 *
 * Pure and React-free; consumed by the TraceDiff and ComparisonReport views.
 * Deliberately not character-level diffing: LLM answers to one question rarely
 * match verbatim, so only sentence/line granularity produces meaningful overlap.
 */

/** One aligned row of two answers (a = reference column, b = compared column). */
export interface AlignedUnit {
  kind: "same" | "only-a" | "only-b";
  a?: string;
  b?: string;
}

/** Objective entities extracted from one answer. */
export interface AnswerEntities {
  /** Workspace-ish paths (contain a path separator or a known extension). */
  paths: string[];
  /** http(s) links. */
  urls: string[];
  /** Shell/code command lines (backticked or prefixed with a known runner). */
  commands: string[];
  /** Standalone numbers with optional units (versions, sizes, counts). */
  numbers: string[];
}

/** Per-column entity view plus the cross-column consensus. */
export interface EntityComparison {
  /** Entities present in EVERY compared column (order: first column's order). */
  shared: AnswerEntities;
  /**
   * Non-consensus entities with their owning columns: single-column exclusives
   * (the sharpest differentiator) and multi-column subsets alike.
   */
  partial: Array<{ entity: string; kind: keyof AnswerEntities; columns: string[] }>;
}

/** Cap per answer: beyond this many units the tail is ignored (DOM + O(n·m) guard). */
const MAX_UNITS = 400;

/**
 * Splits an answer into comparable units: non-blank lines, each further split on
 * sentence enders so long prose paragraphs still produce granular alignment rows.
 */
export function splitAnswerUnits(text: string): string[] {
  const units: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    // Markdown table rows and list items stay whole; prose splits on enders.
    if (/^[-*|>]|^\d+\./.test(trimmed)) {
      units.push(trimmed);
      continue;
    }
    for (const part of trimmed.split(/(?<=[。！？.!?;；])\s*/)) {
      const piece = part.trim();
      if (piece !== "") units.push(piece);
    }
  }
  return units.length > MAX_UNITS ? units.slice(0, MAX_UNITS) : units;
}

/**
 * Aligns two answers' units via LCS (case-sensitive; wording is signal here).
 * Units equal after whitespace normalization count as shared so formatting
 * noise (list markers, trailing spaces) does not split genuinely equal lines.
 */
export function alignAnswers(a: string, b: string): AlignedUnit[] {
  const au = splitAnswerUnits(a);
  const bu = splitAnswerUnits(b);
  const norm = (unit: string) => unit.replace(/\s+/g, " ").toLowerCase();
  const an = au.map(norm);
  const bn = bu.map(norm);
  // dp[i][j] = LCS length of au[i..] / bu[j..]
  const dp: Uint32Array[] = Array.from({ length: an.length + 1 }, () => new Uint32Array(bn.length + 1));
  for (let i = an.length - 1; i >= 0; i--) {
    for (let j = bn.length - 1; j >= 0; j--) {
      dp[i]![j] = an[i] === bn[j] ? (dp[i + 1]![j + 1] ?? 0) + 1 : Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
    }
  }
  const rows: AlignedUnit[] = [];
  let i = 0;
  let j = 0;
  while (i < an.length && j < bn.length) {
    if (an[i] === bn[j]) {
      rows.push({ kind: "same", a: au[i], b: bu[j] });
      i += 1;
      j += 1;
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      rows.push({ kind: "only-a", a: au[i] });
      i += 1;
    } else {
      rows.push({ kind: "only-b", b: bu[j] });
      j += 1;
    }
  }
  while (i < an.length) rows.push({ kind: "only-a", a: au[i++] });
  while (j < bn.length) rows.push({ kind: "only-b", b: bu[j++] });
  return rows;
}

/**
 * Similarity of two answers in [0,1]: shared units over the larger unit count.
 * Matching is multiset-based, so a repeated sentence must be repeated in both
 * answers to reach 1; 0 = nothing in common; empty answers score 1 (vacuous).
 */
export function answerSimilarity(a: string, b: string): number {
  const au = splitAnswerUnits(a);
  const bu = splitAnswerUnits(b);
  if (au.length === 0 && bu.length === 0) return 1;
  const norm = (unit: string) => unit.replace(/\s+/g, " ").toLowerCase();
  const pool = new Map<string, number>();
  for (const unit of bu) {
    const key = norm(unit);
    pool.set(key, (pool.get(key) ?? 0) + 1);
  }
  let shared = 0;
  for (const unit of au) {
    const key = norm(unit);
    const left = pool.get(key) ?? 0;
    if (left === 0) continue;
    shared += 1;
    pool.set(key, left - 1);
  }
  return shared / Math.max(au.length, bu.length);
}

/**
 * Directory-qualified paths (src/lib.js, data/runs/x) — requires a separator.
 * The leading lookbehind anchors each match at a token-run boundary, keeping
 * slash-free text linear (no per-position re-scan quadratic backtracking);
 * the tail requires a word character so a bare "../" is never an entity.
 */
const PATH_PATTERN = /(?<![\w@.-])(?:\.{1,2}\/)?(?:[\w@.-]+\/)+[\w@.-]*[\w@-]/g;
/** Bare filenames with a known workspace extension (README.md, main.py). */
const FILENAME_PATTERN = /\b[a-zA-Z_][\w-]*\.(?:ts|tsx|js|jsx|json|md|txt|html|css|py|go|rs|java|yml|yaml|toml|sh|ps1|log|csv)\b/g;
const URL_PATTERN = /https?:\/\/[^\s)\]"'`]+/g;
/** Trailing sentence punctuation that is not part of the URL itself. */
const URL_TRAILING_PUNCT = /[.,;:!?\u3002\uFF0C\uFF1B\uFF1A\uFF01\uFF1F]+$/;
const COMMAND_PATTERN = /`([^`\n]+)`/g;
/** Letter units need a word boundary: without it "25 steps" reads as "25 s". */
const NUMBER_PATTERN = /(?:\d+\.\d+|\d+)(?:\s?(?:%|(?:ms|kb|mb|gb|px|s|x)\b))?/gi;

/** Extracts objective entities from one answer, each list deduplicated in order.
 *  Later kinds run on text with earlier kinds' matches removed, so a directory
 *  path is never re-extracted as a bare filename and a URL never leaks into paths. */
export function extractAnswerEntities(text: string): AnswerEntities {
  const dedupe = (items: string[]) => Array.from(new Set(items.map((item) => item.trim()).filter((item) => item !== "")));
  const stripMatches = (source: string, pattern: RegExp) =>
    source.replace(pattern, (matched) => " ".repeat(matched.length));
  const urls = dedupe((text.match(URL_PATTERN) ?? []).map((url) => url.replace(URL_TRAILING_PUNCT, "")));
  const withoutUrls = stripMatches(text, URL_PATTERN);
  const dirPaths = withoutUrls.match(PATH_PATTERN) ?? [];
  const withoutDirPaths = stripMatches(withoutUrls, PATH_PATTERN);
  const bareFilenames = withoutDirPaths.match(FILENAME_PATTERN) ?? [];
  const paths = dedupe([...dirPaths, ...bareFilenames]);
  const withoutAllPaths = stripMatches(withoutDirPaths, FILENAME_PATTERN);
  const commands = dedupe(Array.from(withoutAllPaths.matchAll(COMMAND_PATTERN), (m) => m[1] ?? ""))
    .filter((cmd) => cmd.includes(" ") || /[\\/>|=;]/.test(cmd));
  const numbers = dedupe(withoutAllPaths.match(NUMBER_PATTERN) ?? []);
  return { paths, urls, commands, numbers };
}

/** Entity kinds in display order; the views iterate this so the lists never drift. */
export const ENTITY_KINDS: ReadonlyArray<keyof AnswerEntities> = ["paths", "urls", "commands", "numbers"];

/**
 * Cross-column entity comparison: which objective facts are consensus and which
 * appear in only some answers. Labels follow the input order.
 */
export function compareAnswerEntities(
  perColumn: Array<{ label: string; text: string }>,
): EntityComparison {
  const shared: AnswerEntities = { paths: [], urls: [], commands: [], numbers: [] };
  const partial: EntityComparison["partial"] = [];
  if (perColumn.length === 0) return { shared, partial };
  const extracted = perColumn.map(({ text }) => extractAnswerEntities(text));
  for (const kind of ENTITY_KINDS) {
    const first = new Set(extracted[0]?.[kind] ?? []);
    const inAll = Array.from(first).filter((entity) =>
      extracted.every((col) => col[kind].includes(entity)),
    );
    shared[kind].push(...inAll);
    const ownerMap = new Map<string, string[]>();
    for (let index = 0; index < extracted.length; index++) {
      const label = perColumn[index]?.label ?? "";
      for (const entity of extracted[index]?.[kind] ?? []) {
        if (inAll.includes(entity)) continue;
        const owners = ownerMap.get(entity) ?? [];
        if (!owners.includes(label)) owners.push(label);
        ownerMap.set(entity, owners);
      }
    }
    for (const [entity, columns] of ownerMap) {
      partial.push({ entity, kind, columns });
    }
  }
  return { shared, partial };
}
