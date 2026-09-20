/**
 * @file loop
 * @description Framework-neutral verification loop wrapping driver.run attempts.
 *
 * Responsibilities:
 * - Retry failed attempts via verify/reflect/edit cycles
 * - Suppress intermediate completes so consumers see one column completion
 * - Emit verify/reflect/harness_edit control events between attempts
 */

import type { ArenaEvent, HarnessLevel, LlmAdapter } from "@agentprism/contracts";
import type { TokenTracker } from "@agentprism/telemetry";
import { countActionEvents, extractAnswerFromEvents } from "@agentprism/contracts";
import { verifyResult } from "./judge.js";
import { reflectOnFailure } from "./reflect.js";
import { proposeHarnessEdit } from "./evolve.js";
import { sanitizePromptAdditions } from "@agentprism/contracts";

const HARNESS_MAX_RETRIES: Record<HarnessLevel, number> = {
  bare: 1,
  verify: 2,
  reflect: 2,
  self_evolve: 2,
};

export interface VerificationLoopDeps {
  level: HarnessLevel;
  question: string;
  llm: LlmAdapter;
  tracker?: TokenTracker;
  signal?: AbortSignal;
  /** Mutable feedback bag read by buildSystemUser on the next attempt. */
  feedback: { text: string };
  pipelineLabel: string;
  workspaceName: string;
  /** Per-level retry cap override (settings knobs); absent levels keep HARNESS_MAX_RETRIES. */
  maxRetries?: Partial<Record<HarnessLevel, number>>;
}

export type DriverAttemptFactory = () => AsyncIterable<ArenaEvent>;

function controlEvent(
  type: "verify" | "reflect" | "harness_edit",
  deps: VerificationLoopDeps,
  content: string,
  passed: boolean | null,
): ArenaEvent {
  return {
    type,
    pipeline: deps.pipelineLabel,
    workspace: deps.workspaceName,
    content,
    tool: "",
    args: {},
    result: "",
    step: 0,
    passed,
    reason: "",
    metrics: null,
    message: "",
    token_stats: null,
    turn: 0,
    runId: "",
    timestamp: 0,
  };
}

/**
 * Runs one or more driver attempts according to the harness level.
 * Yields ArenaEvents from each attempt (suppressing intermediate complete/error)
 * plus verification control events.
 */
export async function* runVerificationLoop(
  deps: VerificationLoopDeps,
  attempt: DriverAttemptFactory,
): AsyncGenerator<ArenaEvent> {
  const maxRetries = deps.maxRetries?.[deps.level] ?? HARNESS_MAX_RETRIES[deps.level] ?? 1;
  if (deps.level === "bare") {
    yield* attempt();
    return;
  }

  let attempts = 0;
  while (attempts < maxRetries) {
    attempts += 1;
    if (attempts === 1) deps.feedback.text = "";
    const collected: ArenaEvent[] = [];
    const isLast = attempts >= maxRetries;

    for await (const event of attempt()) {
      collected.push(event);
      if (!isLast && (event.type === "complete" || event.type === "error")) {
        continue;
      }
      yield event;
    }

    const answer = extractAnswerFromEvents(collected);
    const toolCalls = countActionEvents(collected);
    const verdict =
      answer !== ""
        ? await verifyResult(deps.question, answer, toolCalls, deps.llm, {
            signal: deps.signal,
            tracker: deps.tracker,
          })
        : { passed: false, reason: "No valid output" };

    yield controlEvent(
      "verify",
      deps,
      `[${deps.level}] verify #${attempts}: ${verdict.reason}`,
      verdict.passed,
    );

    if (verdict.passed || isLast) break;

    if (deps.level === "verify") {
      deps.feedback.text = "";
      continue;
    }

    const insight = await reflectOnFailure(deps.question, answer, verdict.reason, deps.llm, {
      signal: deps.signal,
      tracker: deps.tracker,
    });
    yield controlEvent("reflect", deps, `[reflect #${attempts}] ${insight}`, null);

    let feedback = sanitizePromptAdditions([insight]);
    if (deps.level === "self_evolve") {
      const edit = await proposeHarnessEdit(deps.question, answer, insight, feedback, deps.llm, {
        signal: deps.signal,
        tracker: deps.tracker,
      });
      yield controlEvent("harness_edit", deps, `[self-evolve #${attempts}] ${JSON.stringify(edit).slice(0, 300)}`, null);
      const additions = edit.prompt_additions;
      if (Array.isArray(additions) && additions.length > 0) {
        const safe = sanitizePromptAdditions(additions);
        if (safe !== "") {
          feedback = `${feedback}\n\n[Harness self-evolve]\n${safe}`.trim();
        }
      }
    }
    deps.feedback.text = feedback;
  }
}
