/**
 * @file self-consistency
 * @description LangGraph self-consistency loop: N independent react attempts, then majority vote.
 *
 * Responsibilities:
 * - Stream each attempt's compiled react graph with a fresh initial state
 * - Emit every attempt's events normally, then the shared vote outcome
 *
 * Fresh initial states are the independence requirement: attempt N sees only
 * the task, never earlier attempts' transcripts. max_steps applies per attempt
 * (documented semantics: attempts are full react runs, cost scales with N).
 */

import type { ArenaEvent } from "@agentprism/contracts";
import { extractAnswerFromEvents } from "@agentprism/contracts";
import { selfConsistencyOutcomeEvents } from "@agentprism/driver-registry";

/**
 * Runs the self-consistency loop for one langgraph column. The caller supplies
 * an attempt-stream factory (fresh graph state per attempt); the driver's
 * complete event and metrics tail stay with the caller.
 */
export async function* runSelfConsistencyLoop(args: {
  attempts: number;
  attemptStream: (attempt: number) => AsyncGenerator<ArenaEvent>;
  fields: { label: string; workspace: string; step: () => number };
}): AsyncGenerator<ArenaEvent> {
  const samples: string[] = [];
  for (let attempt = 1; attempt <= args.attempts; attempt += 1) {
    const attemptEvents: ArenaEvent[] = [];
    for await (const event of args.attemptStream(attempt)) {
      attemptEvents.push(event);
      yield event;
    }
    const answer = extractAnswerFromEvents(attemptEvents).trim();
    if (answer !== "") samples.push(answer);
  }
  yield* selfConsistencyOutcomeEvents(samples, args.attempts, {
    label: args.fields.label,
    workspace: args.fields.workspace,
    step: args.fields.step(),
  });
}
