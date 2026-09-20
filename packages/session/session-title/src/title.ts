/**
 * @file session-title/title
 * @description Deterministic session titles with an LLM-hook port.
 *
 * Responsibilities:
 * - Squeeze titles from the first user prompt (question-shaped text)
 * - Fall back to keyword extraction when prompts are missing
 * - Offer a `Titler` port for model titles with deterministic fallback
 *
 * Title generation never throws and never returns blank: model failures,
 * empty prompts, and hostile text all resolve through the same fallback
 * chain. The deterministic path needs no model, so lists stay titled offline.
 */

import { firstUsableTitle, normalizeTitle, TITLE_FALLBACK } from "./normalize.js";

/** Async title generator hook (host-supplied, e.g. an LLM call). */
export type Titler = (input: { question: string; answer: string }) => Promise<string>;

/** Stopwords excluded from keyword titles (English + common CJK particles). */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are",
  "how", "what", "why", "please", "帮我", "请", "的", "了", "在", "和", "与",
]);

/** Extracts up to 5 salient keywords from text (length > 2, not stopwords). */
export function extractKeywords(text: string, limit: number = 5): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of words) {
    if (word.length <= 2 || STOPWORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= Math.max(1, limit)) break;
  }
  return out;
}

/**
 * Squeezes a title from the first user prompt: first non-empty line, capped.
 * Question-shaped prompts keep their shape (lists read as questions).
 */
export function titleFromPrompt(prompt: string): string | null {
  const line = prompt.split("\n").map((part) => part.trim()).find((part) => part !== "");
  if (line === undefined) return null;
  return normalizeTitle(line);
}

/**
 * Builds a keyword title (`a · b · c`) when no prompt line survives.
 * Returns null when nothing salient exists (caller falls back further).
 */
export function titleFromKeywords(text: string): string | null {
  const keywords = extractKeywords(text);
  if (keywords.length === 0) return null;
  return normalizeTitle(keywords.slice(0, 3).join(" · "));
}

/**
 * Titles a session: model hook first (when supplied), then prompt squeeze,
 * then keywords, then the stable fallback. Never throws, never blank.
 */
export async function titleSession(
  input: { question: string; answer?: string },
  options: { titler?: Titler; fallback?: string } = {},
): Promise<string> {
  const fallback = options.fallback ?? TITLE_FALLBACK;
  if (options.titler !== undefined) {
    try {
      const generated = normalizeTitle(await options.titler({ question: input.question, answer: input.answer ?? "" }));
      if (generated !== null) return generated;
    } catch {
      // Model failures fall through to the deterministic chain.
    }
  }
  const squeezed = titleFromPrompt(input.question);
  if (squeezed !== null) return squeezed;
  return firstUsableTitle([titleFromKeywords(`${input.question}\n${input.answer ?? ""}`) ?? ""], fallback);
}
