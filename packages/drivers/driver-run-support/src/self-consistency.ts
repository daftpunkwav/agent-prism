/**
 * @file self-consistency
 * @description Shared self-consistency vote outcome events.
 *
 * Responsibilities:
 * - Vote over attempt answers with the contracts majority vote
 * - Emit the tally reflect event and the winning answer as the final thought
 *
 * Consumed by the native and langgraph drivers so the winner-thought contract
 * (last thought wins answer extraction) stays identical across backends.
 */

import type { ArenaEvent } from "@agentprism/contracts";
import { majorityVote } from "@agentprism/contracts";
import { eventOf } from "./event-translation.js";

/**
 * Builds the post-vote event pair for one self-consistency run: a reflect
 * event carrying the vote tally (never mistaken for the answer) and a final
 * thought event carrying the winning answer (last thought wins extraction).
 * With zero completed samples, only a failure reflect event is emitted.
 */
export function selfConsistencyOutcomeEvents(
  samples: string[],
  attempts: number,
  fields: { label: string; workspace: string; step: number },
): ArenaEvent[] {
  if (samples.length === 0) {
    return [
      eventOf({
        type: "reflect",
        pipeline: fields.label,
        workspace: fields.workspace,
        step: fields.step,
        content: `[Self-Consistency] no attempt produced an answer within the step budget (${attempts} attempt slot(s)).`,
      }),
    ];
  }
  const { winner, counts } = majorityVote(samples);
  const tally = counts.map((count, index) => `attempt ${index + 1}: ${count} vote(s)`).join(", ");
  return [
    eventOf({
      type: "reflect",
      pipeline: fields.label,
      workspace: fields.workspace,
      step: fields.step,
      content: `[Self-Consistency] ${samples.length}/${attempts} attempt(s) completed; attempt ${winner + 1} wins (${tally}).`,
    }),
    eventOf({
      type: "thought",
      pipeline: fields.label,
      workspace: fields.workspace,
      step: fields.step,
      content: samples[winner] ?? "",
    }),
  ];
}
