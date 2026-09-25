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
  const cleaned = text.replaceAll(",", "");
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
  const got = numbers[0];
  if (got === undefined) {
    return result(false, "No number extracted from answer", [`Expected ${spec.operator} ${spec.value}`]);
  }
  const target = spec.value;
  let ok: boolean;
  if (spec.operator === "==") ok = Math.abs(got - target) <= spec.tolerance;
  else if (spec.operator === ">=") ok = got >= target;
  else if (spec.operator === "<=") ok = got <= target;
  else if (spec.operator === ">") ok = got > target;
  else ok = got < target;
  return result(
    ok,
    ok ? "Numeric comparison passed" : `Numeric comparison failed: ${got} ${spec.operator} ${target}`,
    [`Extracted number: ${got}`, `Expected: ${spec.operator} ${target}`],
  );
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

function checkRegex(answer: string, spec: JudgeSpec): JudgeResult {
  if (spec.pattern === "") {
    return result(false, "Regex not configured", []);
  }
  if (spec.pattern.length > 500) {
    return result(false, "Regex too long; rejected", []);
  }
  // ReDoS defense: truncate over-long input (nested-quantifier backtracking risk remains; templates are internal config)
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
