/**
 * @file ask-user-channel
 * @description Shared ask_user human channel: pending batches, answers, settle semantics.
 *
 * Responsibilities:
 * - Hold the in-flight ask_user batch per caller-owned key (agent id, session id)
 * - Deliver human answers and settle the batch once every question has one
 * - Degrade to headless defer on deadline or abort
 *
 * One implementation serves both consumers (the arena runner per column, the
 * builder service per session): the settle semantics are subtle (idempotency
 * guard, successor eviction, unrefed timer) and were previously duplicated by
 * hand, so a semantic fix had to be mirrored across two files. The channel is
 * agnostic to the key namespace; callers keep their own lookup paths.
 */

import type { AskUserQuestion, AskUserReply } from "@agentprism/contracts";
import { DEFAULT_ASK_USER_WAIT_MS } from "@agentprism/contracts";

/** One ask_user batch awaiting the human. */
interface PendingBatch {
  questions: AskUserQuestion[];
  answers: Map<string, string>;
  /** Resolves the whole batch; invoked once, by whichever terminal path wins. */
  settle: (reply: AskUserReply) => void;
  settled: boolean;
}

/** Channel options (absent fields keep the contracts default). */
export interface AskUserChannelOptions {
  /** Human-channel wait in ms before ask_user degrades to headless defer (default 5min). */
  waitMs?: number;
}

/** Defensive copy: transport serializes these, but in-process callers must not mutate live batches. */
function copyAskUserQuestion(question: AskUserQuestion): AskUserQuestion {
  return { ...question, options: [...question.options] };
}

/** Ask-side and answer-side of the human channel for ask_user batches. */
export class AskUserChannel {
  /** In-flight batches keyed by the caller's id (set only while a turn waits on the human). */
  private readonly pending = new Map<string, PendingBatch>();
  private readonly waitMs: number;

  constructor(options: AskUserChannelOptions = {}) {
    const raw = options.waitMs ?? DEFAULT_ASK_USER_WAIT_MS;
    this.waitMs = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : DEFAULT_ASK_USER_WAIT_MS;
  }

  /** Pending questions for one key (copies; empty when none waiting). */
  pendingQuestions(key: string): AskUserQuestion[] {
    const batch = this.pending.get(key);
    if (batch === undefined || batch.settled) return [];
    return batch.questions.map(copyAskUserQuestion);
  }

  /** All keys currently waiting on the human (key + questions). */
  listPending(): Array<{ key: string; questions: AskUserQuestion[] }> {
    const out: Array<{ key: string; questions: AskUserQuestion[] }> = [];
    for (const [key, batch] of this.pending) {
      if (!batch.settled) out.push({ key, questions: batch.questions.map(copyAskUserQuestion) });
    }
    return out;
  }

  /**
   * Delivers one human answer to a pending batch.
   *
   * @returns Whether a live batch was waiting on that question id.
   */
  answer(key: string, questionId: string, answer: string): boolean {
    const batch = this.pending.get(key);
    if (batch === undefined || batch.settled) return false;
    if (!batch.questions.some((question) => question.id === questionId)) return false;
    batch.answers.set(questionId, answer);
    if (batch.answers.size >= batch.questions.length) {
      // settle owns the settled flag: pre-setting it here would trip the
      // idempotency guard and leave the tool's promise unresolved forever.
      batch.settle({ answered: true, answers: [...batch.answers].map(([qid, text]) => ({ id: qid, answer: text })) });
    }
    return true;
  }

  /**
   * Ask-side of the human channel: registers the batch, waits for every answer
   * (or the deadline / abort), and always settles. A deadline or abort settles
   * unanswered, which the tool turns into the headless defer text.
   */
  awaitAnswers(key: string, questions: readonly AskUserQuestion[], signal?: AbortSignal): Promise<AskUserReply> {
    // A previous batch that never settled (defensive) is dropped in favor of the newest one.
    this.pending.delete(key);
    return new Promise<AskUserReply>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const batch: PendingBatch = {
        questions: [...questions],
        answers: new Map(),
        settled: false,
        settle: (reply) => {
          if (batch.settled) return;
          batch.settled = true;
          if (timer !== undefined) clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          // A superseded batch (defensive path) must not evict its successor.
          if (this.pending.get(key) === batch) this.pending.delete(key);
          resolve(reply);
        },
      };
      const onAbort = () => batch.settle({ answered: false, answers: [] });
      this.pending.set(key, batch);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      timer = setTimeout(() => batch.settle({ answered: false, answers: [] }), this.waitMs);
      // Unrefed: a pending question must never keep the process alive on shutdown.
      timer.unref?.();
    });
  }
}
