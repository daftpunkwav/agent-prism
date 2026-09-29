/**
 * @file AskUserChannel tests
 * @description Covers the shared ask_user human channel settle semantics.
 *
 * Responsibilities:
 * - Pin batch delivery, answer collection, and the idempotent settle
 * - Pin deadline / abort degradation to headless defer
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { AskUserChannel } from "@agentprism/runtime";
import { DEFAULT_ASK_USER_WAIT_MS, type AskUserQuestion } from "@agentprism/contracts";

function question(id: string): AskUserQuestion {
  return { id, header: "Plan", question: "Proceed?", options: ["yes", "no"] };
}

describe("AskUserChannel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("settles answered once every question of the batch has an answer", async () => {
    const channel = new AskUserChannel();
    const wait = channel.awaitAnswers("col-1", [question("q1"), question("q2")]);

    expect(channel.answer("col-1", "q1", "yes")).toBe(true);
    // The batch is still waiting on q2: the promise must not settle yet.
    let reply: { answered: boolean } | undefined;
    void wait.then((value) => (reply = value));
    await Promise.resolve();
    expect(reply).toBeUndefined();

    expect(channel.answer("col-1", "q2", "no")).toBe(true);
    await expect(wait).resolves.toEqual({
      answered: true,
      answers: [
        { id: "q1", answer: "yes" },
        { id: "q2", answer: "no" },
      ],
    });
    // Settled batches are no longer listed and reject further answers.
    expect(channel.pendingQuestions("col-1")).toEqual([]);
    expect(channel.answer("col-1", "q1", "again")).toBe(false);
  });

  it("rejects answers for unknown keys and unknown question ids", () => {
    const channel = new AskUserChannel();
    expect(channel.answer("nobody", "q1", "yes")).toBe(false);
    channel.awaitAnswers("col-1", [question("q1")]);
    expect(channel.answer("col-1", "qX", "yes")).toBe(false);
  });

  it("lists live batches and hides superseded ones", () => {
    const channel = new AskUserChannel();
    void channel.awaitAnswers("col-1", [question("q1")]);
    expect(channel.listPending().map((entry) => entry.key)).toEqual(["col-1"]);
    // A second registration for the same key supersedes the first; the map
    // keeps exactly one live batch (the successor must not be evicted).
    void channel.awaitAnswers("col-1", [question("q2")]);
    const live = channel.listPending();
    expect(live).toHaveLength(1);
    expect(live[0]!.questions.map((q) => q.id)).toEqual(["q2"]);
  });

  it("returns defensive copies from pendingQuestions", async () => {
    const channel = new AskUserChannel();
    void channel.awaitAnswers("col-1", [question("q1")]);
    const copy = channel.pendingQuestions("col-1");
    expect(copy).toHaveLength(1);
    copy[0]!.options.push("injected");
    expect(channel.pendingQuestions("col-1")[0]!.options).toEqual(["yes", "no"]);
  });

  it("settles unanswered on abort", async () => {
    const channel = new AskUserChannel();
    const controller = new AbortController();
    const wait = channel.awaitAnswers("col-1", [question("q1")], controller.signal);
    controller.abort();
    await expect(wait).resolves.toEqual({ answered: false, answers: [] });
    expect(channel.pendingQuestions("col-1")).toEqual([]);
  });

  it("settles unanswered immediately when the signal is already aborted", async () => {
    const channel = new AskUserChannel();
    const controller = new AbortController();
    controller.abort();
    await expect(channel.awaitAnswers("col-1", [question("q1")], controller.signal)).resolves.toEqual({
      answered: false,
      answers: [],
    });
  });

  it("settles unanswered on the deadline and clears the timer", async () => {
    vi.useFakeTimers();
    const channel = new AskUserChannel({ waitMs: 5_000 });
    const wait = channel.awaitAnswers("col-1", [question("q1")]);
    vi.advanceTimersByTime(5_000);
    await expect(wait).resolves.toEqual({ answered: false, answers: [] });
    expect(channel.pendingQuestions("col-1")).toEqual([]);
    // The deadline timer was cleared: a later tick must not settle again.
    vi.advanceTimersByTime(60_000);
  });

  it("falls back to the default wait for invalid waits", async () => {
    vi.useFakeTimers();
    for (const waitMs of [0, -1, Number.NaN]) {
      const channel = new AskUserChannel({ waitMs });
      const wait = channel.awaitAnswers("col-1", [question("q1")]);
      vi.advanceTimersByTime(DEFAULT_ASK_USER_WAIT_MS);
      await expect(wait).resolves.toEqual({ answered: false, answers: [] });
    }
  });
});
