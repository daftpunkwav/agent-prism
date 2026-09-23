/**
 * @file codeHighlight
 * @description Lightweight regex tokenizer for workspace file previews.
 *
 * Responsibilities:
 * - Map file extensions to a small language set
 * - Tokenize source text into comment/string/number/keyword spans
 *
 * Deliberately dependency-free: workspace files are small and the four token
 * kinds cover the highlight expectations of a preview pane; a full grammar
 * engine would add a bundle-sized dependency for no preview-quality gain.
 */

/** Token kinds the renderer maps onto CSS classes. */
export type CodeTokenKind = "comment" | "string" | "number" | "keyword";

/** One tokenized slice: kind null means plain text between matches. */
export interface CodeToken {
  text: string;
  kind: CodeTokenKind | null;
}

/** Per-language matchers: earlier alternatives win; the scanner is single-pass. */
interface LanguageSpec {
  pattern: RegExp;
  /** kind per group index: group names are positional (g0, g1, ...) since kinds repeat across rules. */
  kinds: CodeTokenKind[];
}

/** Builds a single alternation regex from (pattern, kind) pairs. */
function compile(rules: Array<[string, CodeTokenKind]>): LanguageSpec {
  const source = rules.map(([pattern], index) => `(?<g${index}>${pattern})`).join("|");
  return { pattern: new RegExp(source, "gsm"), kinds: rules.map(([, kind]) => kind) };
}

/** Shared string literals: single/double quotes with backslash escapes, template literals, and triple-quoted blocks first. */
const STRINGS =
  "(?:[rRbBfFuU]{0,2}\"\"\"[\\s\\S]*?\"\"\"|[rRbBfFuU]{0,2}'''[\\s\\S]*?'''|`(?:\\\\[\\s\\S]|[^`\\\\])*`|\"(?:\\\\[\\s\\S]|[^\\\"\\\\\\\\])*\"|'(?:\\\\[\\s\\S]|[^'\\\\\\\\])*')";
const NUMBERS = "(?:0[xXbBoO][0-9a-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)";
const IDENT = "[A-Za-z_$][\\w$]*";

/** Python: # comments, triple-quoted strings, decorated identifiers. */
const PYTHON = compile([
  [STRINGS, "string"],
  ["#[^\\n]*", "comment"],
  [NUMBERS, "number"],
  [
    `\\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|True|try|while|with|yield)\\b`,
    "keyword",
  ],
]);

/** JavaScript / TypeScript: // and block comments, template literals, ts modifiers. */
const JS_TS = compile([
  [`//[^\\n]*`, "comment"],
  [`/\\*[\\s\\S]*?\\*/`, "comment"],
  [STRINGS, "string"],
  [NUMBERS, "number"],
  [
    `\\b(?:any|as|async|await|boolean|break|case|catch|class|const|continue|default|delete|do|else|enum|export|extends|false|finally|for|from|function|if|implements|import|in|instanceof|interface|let|new|null|number|of|private|protected|public|readonly|return|satisfies|static|string|super|switch|this|throw|true|try|type|typeof|undefined|unknown|var|void|while|yield)\\b`,
    "keyword",
  ],
]);

/** JSON: the whole document is strings/numbers/literals. */
const JSON_LANG = compile([
  [`"(?:\\\\[\\s\\S]|[^\\\"\\\\\\\\])*"`, "string"],
  [NUMBERS, "number"],
  [`\\b(?:true|false|null)\\b`, "keyword"],
]);

/** Shell: # comments, strings, common keywords, $variables. */
const SHELL = compile([
  [`#[^\\n]*`, "comment"],
  [STRINGS, "string"],
  [`\\$\\{?[$#@?][\\w]*\\}?|\\$\\w+`, "keyword"],
  [NUMBERS, "number"],
  [`\\b(?:case|do|done|elif|else|esac|fi|for|function|if|in|return|select|then|until|while)\\b`, "keyword"],
]);

/** YAML: # comments, quoted strings, key colons stay plain, scalars. */
const YAML = compile([
  [`#[^\\n]*`, "comment"],
  [STRINGS, "string"],
  [`\\b(?:true|false|null|yes|no|on|off)\\b`, "keyword"],
  [`^[ \\t*-]*[\\w.\\/-]+(?=:)`, "keyword"],
  [NUMBERS, "number"],
]);

/** CSS: comments, strings, at-rules and numbers with units. */
const CSS = compile([
  [`/\\*[\\s\\S]*?\\*/`, "comment"],
  [STRINGS, "string"],
  [`@[\\w-]+`, "keyword"],
  [`#[0-9a-fA-F]{3,8}\\b|\\b-?\\d+(?:\\.\\d+)?(?:px|em|rem|vh|vw|dvh|s|ms|%)?`, "number"],
]);

/** HTML / XML: comments, tags (with their name), attribute strings. */
const HTML_XML = compile([
  [`<!--[\\s\\S]*?-->`, "comment"],
  [`</?[\\w:-]+`, "keyword"],
  [`/?>`, "keyword"],
  [`\"(?:\\\\[\\s\\S]|[^\\\"\\\\\\\\])*\"|'(?:\\\\[\\s\\S]|[^'\\\\\\\\])*'`, "string"],
]);

/** Markdown source: headings, fenced blocks, bold/italic/code spans. */
const MARKDOWN = compile([
  [`^#{1,6}[^\\n]*`, "keyword"],
  ["```[\\s\\S]*?```|~~~[\\s\\S]*?~~~", "string"],
  [`\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__|(?<![*\\w])\\*[^*\\n]+\\*|(?<![_\\w])_[^_\\n]+_`, "keyword"],
  ["`[^`\\n]+`", "string"],
  [`^>[^\\n]*`, "comment"],
]);

const EXT_LANGUAGE: Record<string, LanguageSpec> = {
  py: PYTHON,
  pyw: PYTHON,
  pyi: PYTHON,
  js: JS_TS,
  jsx: JS_TS,
  mjs: JS_TS,
  cjs: JS_TS,
  ts: JS_TS,
  tsx: JS_TS,
  json: JSON_LANG,
  jsonc: JSON_LANG,
  sh: SHELL,
  bash: SHELL,
  zsh: SHELL,
  ps1: SHELL,
  psm1: SHELL,
  yml: YAML,
  yaml: YAML,
  toml: YAML,
  ini: YAML,
  css: CSS,
  scss: CSS,
  html: HTML_XML,
  htm: HTML_XML,
  xml: HTML_XML,
  svg: HTML_XML,
  md: MARKDOWN,
  markdown: MARKDOWN,
};

/** Resolves the highlighter language for a file path ("" = plain text). */
export function languageOfPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    // Extensionless well-known names (Dockerfile, Makefile, LICENSE) stay plain.
    return "";
  }
  const ext = base.slice(dot + 1).toLowerCase();
  return ext in EXT_LANGUAGE ? ext : "";
}

/** Tokenizes text for the given extension-derived language; plain text yields one token. */
export function tokenizeCode(text: string, language: string): CodeToken[] {
  const spec = EXT_LANGUAGE[language];
  if (!spec) return [{ text, kind: null }];
  const tokens: CodeToken[] = [];
  let last = 0;
  spec.pattern.lastIndex = 0;
  for (let match = spec.pattern.exec(text); match !== null; match = spec.pattern.exec(text)) {
    if (match.index > last) tokens.push({ text: text.slice(last, match.index), kind: null });
    const groups = match.groups ?? {};
    const hit = spec.kinds.findIndex((_, index) => groups[`g${index}`] !== undefined);
    const kind: CodeTokenKind | null = (hit >= 0 ? spec.kinds[hit] : undefined) ?? null;
    tokens.push({ text: match[0], kind });
    last = match.index + match[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), kind: null });
  return tokens;
}
