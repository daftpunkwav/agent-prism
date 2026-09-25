/**
 * @file prompts
 * @description Self-critique driver's model-facing copy: critic instruction and
 *              redirect message template (single source; edit copy here only).
 *
 * Responsibilities:
 * - Own the critic review instruction (SCORE/NEXT reply protocol)
 * - Own the redirect message template that feeds a critique back into the run
 */

/** Critic review instruction appended after the transcript. */
export const CRITIC_INSTRUCTION =
  "[Phase: Critic] Review the transcript above. Reply with exactly two lines:\n" +
  "SCORE: <0-10 progress toward the task>\n" +
  "NEXT: <one concrete next action, or DONE>";

/** Redirect message mounting the critique back into the transcript. */
export function criticRedirect(redirects: number, maxRedirects: number, score: number, note: string): string {
  return `[Critic redirect ${redirects}/${maxRedirects} — score ${score}] ${note}`;
}
