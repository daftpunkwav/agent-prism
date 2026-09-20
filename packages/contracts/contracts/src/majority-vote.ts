/**
 * @file majority-vote
 * @description Majority vote over free-text answers (pure function).
 *
 * Responsibilities:
 * - Group trimmed answers by exact match and pick the winning index
 * - Break ties toward the lowest task index
 *
 * Shared by the scatter tool vote strategy and the self-consistency reasoning
 * mode; drivers consume it through the contracts package.
 */

export interface MajorityVoteResult {
  /** Index of the winning answer (ties break to the lowest index). */
  winner: number;
  /** Per-answer vote count: answers in the same group share a count. */
  counts: number[];
}

/**
 * Majority vote over trimmed answers (exact match; ties break to the lowest
 * task index). Free-form text rarely ties exactly, which the counts make
 * visible instead of hiding.
 */
export function majorityVote(answers: string[]): MajorityVoteResult {
  const groups = new Map<string, { count: number; first: number }>();
  answers.forEach((answer, index) => {
    const key = answer.trim();
    const entry = groups.get(key) ?? { count: 0, first: index };
    entry.count += 1;
    groups.set(key, entry);
  });
  let winner = 0;
  let best = -1;
  for (const entry of groups.values()) {
    if (entry.count > best || (entry.count === best && entry.first < winner)) {
      best = entry.count;
      winner = entry.first;
    }
  }
  // Per-task tally: each task shows its own answer-group's vote count.
  const keys = answers.map((answer) => answer.trim());
  const counts = keys.map((key) => groups.get(key)?.count ?? 0);
  return { winner, counts };
}
