/**
 * @file judging
 * @description Deterministic L1 auto-judging for task templates plus LLM-as-Judge.
 *
 * Responsibilities:
 * - Validate answer format and constraints per deterministic judge type
 * - Support keyword, json, code, numeric, exclude, regex, none, and llm types
 * - Offer async LLM judging behind an injected text-invoke port (fail-closed)
 */

import { sanitizeErrorMessage, type JudgeResult, type JudgeSpec, type LlmJudgeAdapter, type LlmJudgeContext } from "@agentprism/contracts";
import { detectInjection, sanitizeForJson } from "@agentprism/contracts";
import { llmJudgePrompt as buildLlmJudgePrompt } from "./prompts.js";

export { buildLlmJudgePrompt };

// The info string (language tag) after the opening fence is stripped for any
// language (```go, ```python3.11, a bare ```), not just python: a tagged fence
// that failed to strip would push the raw ``` markers into max_len and keyword checks.
const CODE_FENCE = /```[^\n`]*\n([\s\S]*?)\n?\s*```/;

function extractNumbers(text: string): number[] {
  // Fold thousands separators only: a bare comma may be a decimal mark ("1,5").
  const cleaned = text.replace(/(\d),(\d{3})\b/g, "$1$2");
  const matches = cleaned.match(/-?\d+(?:\.\d+)?/g) ?? [];
  return matches.map((m) => Number.parseFloat(m));
}

function extractCode(text: string): string {
  const match = CODE_FENCE.exec(text);
  if (match?.[1] !== undefined) return match[1].trim();
  return text.trim();
}

function result(passed: boolean, reason: string, details: string[] = []): JudgeResult {
  return { passed, reason, details };
}

function checkNumeric(answer: string, spec: JudgeSpec): JudgeResult {
  const numbers = extractNumbers(answer);
  if (numbers.length === 0) {
    return result(false, "No number extracted from answer", [`Expected ${spec.operator} ${spec.value}`]);
  }
  const target = spec.value;
  const matches = (got: number): boolean => {
    if (spec.operator === "==") return Math.abs(got - target) <= spec.tolerance;
    if (spec.operator === ">=") return got >= target;
    if (spec.operator === "<=") return got <= target;
    if (spec.operator === ">") return got > target;
    return got < target;
  };
  // "last" reads the concluding number; "any" accepts the value wherever it appears
  // (a column that shows its work still reached it). Details always list both so a
  // failing verdict explains what was actually seen.
  const candidates = spec.numeric_match === "last" ? [numbers[numbers.length - 1] as number] : numbers;
  const matched = candidates.find((candidate) => matches(candidate));
  const shown = numbers.map((value) => (candidates.includes(value) ? String(value) : `${value}(ignored)`)).join(", ");
  if (matched !== undefined) {
    return result(true, "Numeric comparison passed", [
      `Matched number: ${matched}`,
      `Extracted: ${shown}`,
      `Expected: ${spec.operator} ${target}`,
    ]);
  }
  return result(false, `Numeric comparison failed: no extracted number satisfies ${spec.operator} ${target}`, [
    `Extracted: ${shown}`,
    `Expected: ${spec.operator} ${target}`,
  ]);
}

function checkJson(answer: string, spec: JudgeSpec): JudgeResult {
  const candidates = [answer.trim()];
  const brace = /[{[][\s\S]*[}\]]/.exec(answer);
  if (brace !== null) candidates.push(brace[0]);
  let data: unknown;
  let parsed = false;
  for (const candidate of candidates) {
    try {
      data = JSON.parse(candidate);
      parsed = true;
      break;
    } catch {
      continue;
    }
  }
  if (!parsed) {
    return result(false, "Answer is not valid JSON", ["JSON parse failed"]);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return result(false, "JSON top-level value must be an object", [`Actual type: ${data === null ? "null" : typeof data}`]);
  }
  const record = data as Record<string, unknown>;
  // Own-property check: `in` walks the prototype chain, so a required field named
  // "toString"/"constructor" would falsely pass without existing in the answer.
  const missing = spec.required_fields.filter((field) => !Object.hasOwn(record, field));
  if (missing.length > 0) {
    return result(false, `Missing fields: ${missing.join(", ")}`, missing);
  }
  return result(true, "JSON parse and field checks passed", Object.keys(record));
}

function checkCode(answer: string, spec: JudgeSpec): JudgeResult {
  const code = extractCode(answer);
  if (code.length > spec.max_len) {
    return result(false, `Code too long (${code.length} > ${spec.max_len})`, ["Length exceeded"]);
  }
  const missing = spec.must_contain.filter((keyword) => !code.includes(keyword));
  if (missing.length > 0) {
    return result(false, `Missing keywords: ${missing.join(", ")}`, missing);
  }
  return result(true, "Code block checks passed", [`${code.length} chars`]);
}

function checkKeyword(answer: string, spec: JudgeSpec): JudgeResult {
  // Deduplicated counting: a keyword present in both any_of/all_of counts once.
  const hits = new Set<string>();
  for (const keyword of spec.any_of) {
    if (answer.includes(keyword)) hits.add(keyword);
  }
  for (const keyword of spec.all_of) {
    if (answer.includes(keyword)) {
      hits.add(keyword);
    } else {
      return result(false, `Missing keyword: ${keyword}`, [`Must include: ${keyword}`]);
    }
  }
  if (hits.size < spec.min_hits) {
    return result(false, `Not enough keyword hits (${hits.size}/${spec.min_hits})`, [
      `Hit keywords: ${hits.size > 0 ? [...hits].join(", ") : "none"}`,
    ]);
  }
  return result(true, `Keyword hits: ${hits.size}`, [...hits]);
}

function checkExclude(answer: string, spec: JudgeSpec): JudgeResult {
  const found = spec.patterns.filter((pattern) => answer.includes(pattern));
  if (found.length > 0) {
    return result(false, `Answer contains excluded patterns: ${found.join(", ")}`, found);
  }
  return result(true, "No excluded patterns found", []);
}

/**
 * Detects nested-quantifier shapes — a quantified group whose content carries a
 * quantifier, e.g. `(a+)+`, `(.*)*`, `(a|b+){2,}` — the catastrophic-backtracking
 * class a synchronous `RegExp.test` cannot bound (no native timeout exists).
 * Escaped characters and `[...]` char classes are skipped so their quantifier
 * lookalikes never trigger a false rejection. A rejected pattern fails closed
 * with an explicit reason instead of pinning the event loop mid-judgement.
 */
function hasNestedQuantifier(pattern: string): boolean {
  // Whether a quantifier appeared directly inside each open group frame.
  const groupHasQuantifier: boolean[] = [];
  let depth = 0;
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (char === "[") {
      // Char class: quantifier characters inside are literals (a `]` right after
      // `[` or `[^` is a literal member, per the same rule regex itself applies).
      if (pattern[i + 1] === "^") i += 1;
      if (pattern[i + 1] === "]") i += 1;
      while (i < pattern.length && pattern[i] !== "]") {
        if (pattern[i] === "\\") i += 1;
        i += 1;
      }
      continue;
    }
    if (char === "(") {
      depth += 1;
      groupHasQuantifier[depth] = false;
      // Skip the group prefix (`?:`, `?=`, `?!`, lookbehinds, `?<name>`) so its
      // `?` never registers as a quantifier inside the fresh frame — `(?:ab)+`
      // must stay legal while `(a+)+` does not.
      if (pattern[i + 1] === "?") {
        if (pattern[i + 2] === "<" && pattern[i + 3] !== "=" && pattern[i + 3] !== "!") {
          const close = pattern.indexOf(">", i + 3);
          if (close !== -1) i = close;
        } else {
          i += 1;
        }
      }
      continue;
    }
    if (char === ")") {
      const inner = groupHasQuantifier[depth] === true;
      depth -= 1;
      if (inner && isQuantifierAt(pattern, i + 1)) return true;
      continue;
    }
    if (isQuantifierAt(pattern, i)) {
      groupHasQuantifier[depth] = true;
    }
  }
  return false;
}

/** Whether the position starts a quantifier token (`*`, `+`, `?`, `{n[,m]}`). */
function isQuantifierAt(pattern: string, index: number): boolean {
  const char = pattern[index];
  if (char === "*" || char === "+" || char === "?") return true;
  if (char === "{" && /^\{\d+(,\d*)?\}/.exec(pattern.slice(index)) !== null) return true;
  return false;
}

function checkRegex(answer: string, spec: JudgeSpec): JudgeResult {
  if (spec.pattern === "") {
    return result(false, "Regex not configured", []);
  }
  if (spec.pattern.length > 500) {
    return result(false, "Regex too long; rejected", []);
  }
  if (hasNestedQuantifier(spec.pattern)) {
    return result(false, "Regex rejected: nested quantifier (catastrophic backtracking risk)", []);
  }
  // ReDoS defense: truncate over-long input (nested-quantifier patterns are rejected above)
  const safeAnswer = answer.slice(0, 2000);
  let ok: boolean;
  try {
    ok = new RegExp(spec.pattern).test(safeAnswer);
  } catch (error) {
    return result(false, `Invalid regex: ${error instanceof Error ? error.message : "Error"}`, []);
  }
  return result(ok, ok ? "Regex matched" : "Regex did not match", [spec.pattern]);
}

/** Judges one answer by JudgeSpec. Empty answers fail outright (except the none type). */
function judgeAnswer(answer: string, spec: JudgeSpec): JudgeResult {
  if (spec.type === "none") {
    return result(true, "This template does not support auto-judging");
  }
  if (spec.type === "llm") {
    return result(false, "LLM judge requires async judging (use judgeAnswersAsync)");
  }
  if (answer.trim() === "") {
    return result(false, "Answer is empty");
  }
  switch (spec.type) {
    case "keyword":
      return checkKeyword(answer, spec);
    case "json":
      return checkJson(answer, spec);
    case "code":
      return checkCode(answer, spec);
    case "numeric":
      return checkNumeric(answer, spec);
    case "exclude":
      return checkExclude(answer, spec);
    case "regex":
      return checkRegex(answer, spec);
    default:
      return result(false, `Unknown judge type: ${spec.type}`);
  }
}

/**
 * Parses one LLM judge response fail-closed (parse failures count as failing).
 * Deliberately no lenient substring fallback: an answer smuggling
 * `"passed": true` outside valid JSON must not earn a pass.
 */
export function parseLlmJudgeResponse(text: string, spec: JudgeSpec): JudgeResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(sanitizeForJson(text)) as Record<string, unknown>;
  } catch {
    return result(false, "LLM judge parse failed; treated as not passed");
  }
  const scoreRaw = parsed.score;
  const score = typeof scoreRaw === "number" && Number.isFinite(scoreRaw) ? Math.min(1, Math.max(0, scoreRaw)) : null;
  const reason = typeof parsed.reason === "string" && parsed.reason !== "" ? parsed.reason.slice(0, 500) : "LLM judge verdict";
  if (score !== null) {
    const passed = score >= spec.passing_score;
    return result(passed, reason, [`score=${score}`, `threshold=${spec.passing_score}`]);
  }
  return result(parsed.passed === true, reason);
}

/** Judges one answer with the LLM adapter (fail-closed on adapter/parse errors). */
async function judgeAnswerLlm(
  answer: string,
  spec: JudgeSpec,
  adapter: LlmJudgeAdapter,
  context: LlmJudgeContext = {},
): Promise<JudgeResult> {
  if (answer.trim() === "") return result(false, "Answer is empty");
  // The answer rides inside the judge prompt: a model under test smuggling
  // override prose fails here instead of steering the verdict (harness parity).
  if (detectInjection(answer)) {
    return result(false, "Possible prompt injection detected; treated as not passed");
  }
  try {
    const response = await adapter.invoke(buildLlmJudgePrompt(answer, spec, context.question));
    return parseLlmJudgeResponse(response, spec);
  } catch (error) {
    return result(false, `LLM judge failed; treated as not passed: ${sanitizeErrorMessage(error)}`);
  }
}

/** Batch judging: {label: answer} → {label: JudgeResult} (pure deterministic rules, no model).
 *
 * @param answers Column label to final-answer text.
 * @param spec Judge spec selecting the rule (keyword/json/code/numeric/exclude/regex/none/llm).
 * @returns Label to verdict; empty answers fail outright (except the none type).
 *   llm specs fail closed here (use judgeAnswersAsync with a judge model).
 */
export function judgeAnswers(answers: Record<string, string>, spec: JudgeSpec): Record<string, JudgeResult> {
  const out: Record<string, JudgeResult> = {};
  for (const [label, text] of Object.entries(answers)) {
    out[label] = judgeAnswer(text, spec);
  }
  return out;
}

/** Async batch judging: deterministic types stay sync; llm type calls the adapter per answer.
 *
 * Answers judge sequentially (not Promise.all): the judge model is a shared
 * downstream, and one slow verdict must not fan out into model overload.
 *
 * @param answers Column label to final-answer text.
 * @param spec Judge spec (llm uses the adapter + optional question context).
 * @param adapter Host-supplied LLM text-invoke port (ignored for deterministic types).
 * @param context Optional question context for the judge prompt.
 * @returns Label to verdict; adapter/parse failures fail closed per answer, never throw.
 */
export async function judgeAnswersAsync(
  answers: Record<string, string>,
  spec: JudgeSpec,
  adapter: LlmJudgeAdapter,
  context: LlmJudgeContext = {},
): Promise<Record<string, JudgeResult>> {
  if (spec.type !== "llm") return judgeAnswers(answers, spec);
  const out: Record<string, JudgeResult> = {};
  for (const [label, text] of Object.entries(answers)) {
    out[label] = await judgeAnswerLlm(text, spec, adapter, context);
  }
  return out;
}
