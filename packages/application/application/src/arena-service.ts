/**
 * @file arena-service
 * @description Comparison-experiment use cases: metadata, run streaming, templates, judging.
 *
 * Responsibilities:
 * - Expose run metadata, templates, and judging to the transport layer
 * - Stream parallel runs through the shared run pool
 * - Fold each run's event stream into a per-turn outline note in the ledger
 * - Construct the run pool lazily once on success; retry on failure
 *
 * Application layer: orchestrates domain packages, owns no IO of its own.
 */

import {
  ARENA_MIN_SELECT,
  DIMENSION_IDS,
  sanitizeErrorMessage,
  type AnswerJudge,
  type ArenaEvent,
  type ArenaMeta,
  type ArenaRunRequest,
  type BaselineOverrides,
  type DimensionId,
  type AskUserQuestion,
  type JudgeResponse,
  type TaskTemplate,
} from "@agentprism/contracts";
import { getTemplate, listTemplates, type DimensionRouter } from "@agentprism/arena-routing";
import { outlineDigest, outlineTurns } from "@agentprism/session-outline";
import type { ArenaRunner } from "@agentprism/arena-runner";
import { AppError } from "./errors.js";
import type { SessionService } from "./session-service.js";

export interface ArenaServiceDeps {
  router: DimensionRouter;
  /** Run-pool factory (driver registry is built at the composition root; invoked only once). */
  runnerFactory: () => Promise<ArenaRunner>;
  /** Durable run ledger (use-case API): every streamed run opens and closes a session here. */
  sessions: SessionService;
  answerJudge: AnswerJudge;
}

/** Outline text cap per event: well above the 240-char rail preview, bounds memory. */
const OUTLINE_TEXT_CAP = 1000;

/**
 * Bounded shallow copy for outline folding: caps the text fields the outline
 * reads (thought content, observation result, error message) so holding the
 * whole stream cannot accumulate full tool outputs. Previews cap at 240 chars,
 * so the folded outline is identical to folding the originals.
 */
function boundedForOutline(event: ArenaEvent): ArenaEvent {
  if (event.type !== "thought" && event.type !== "thought_delta" && event.type !== "observation" && event.type !== "error") {
    return event;
  }
  const key = event.type === "observation" ? "result" : event.type === "error" ? "message" : "content";
  const text = (event as Record<string, unknown>)[key];
  if (typeof text !== "string" || text.length <= OUTLINE_TEXT_CAP) return event;
  return { ...event, [key]: text.slice(0, OUTLINE_TEXT_CAP) } as ArenaEvent;
}

/** Comparison-experiment use cases: metadata, parallel run stream, templates, and judging. */
export class ArenaService {
  private readonly deps: ArenaServiceDeps;
  private runner: ArenaRunner | null = null;
  private runnerInit: Promise<ArenaRunner> | null = null;

  constructor(deps: ArenaServiceDeps) {
    this.deps = deps;
  }

  /** Lazily obtains the run pool (built only once; a failed build may be retried on the next request). */
  async ensureRunner(): Promise<ArenaRunner> {
    if (this.runner !== null) return this.runner;
    this.runnerInit ??= this.deps.runnerFactory();
    try {
      this.runner = await this.runnerInit;
      return this.runner;
    } catch (error) {
      // Clear the failed init promise so transient faults can be retried on the next request.
      this.runnerInit = null;
      throw error;
    }
  }

  async getMeta(): Promise<ArenaMeta> {
    const runner = await this.ensureRunner();
    try {
      // On-demand sync (no-op when already synced); full reprojection is handled by the provider change listener and startup init
      this.deps.router.ensureModelSynced();
    } catch (error) {
      // Sync failure keeps the existing options, but must leave a trace
      console.warn(`[arena] Provider option sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const dimensions = DIMENSION_IDS.map((id) => {
      const options = this.deps.router.listDimensionOptions(id);
      return {
        id,
        label: this.deps.router.dimensionCatalog.fieldLabel(id),
        subtitle: this.deps.router.dimensionCatalog.fieldSubtitle(id),
        options,
        min_select: ARENA_MIN_SELECT,
        max_select: options.length,
      };
    });
    return {
      dimensions,
      frameworks: [...runner.registry.listAvailable(), ...runner.registry.listReserved()],
      baseline_defaults: this.deps.router.dimensionCatalog.baselineDefaultsPayload(),
      baseline_fields: this.deps.router.listBaselineFields(),
      model_compare_ready: this.deps.router.modelCompareReady(),
    };
  }

  /**
   * Validates a pinned baseline with the same resolver the run path uses, so a
   * caller that stores config immutably (threads) fails at creation instead of
   * storing a config whose only failure mode is an in-stream run error.
   *
   * @throws AppError 422 when the baseline cannot be replayed.
   */
  assertBaselineReplayable(dimension: DimensionId, selections: readonly string[], baseline: Record<string, unknown>): void {
    try {
      // Pinned configs carry typed values (numbers for decode fields) exactly like the
      // run path passes them, while BaselineOverrides types the wire form as option
      // tokens (strings); both converge in resolveBaselineOverrides, and this single
      // cast marks that seam.
      this.deps.router.route(dimension, [...selections], baseline as BaselineOverrides);
    } catch (error) {
      throw AppError.unprocessable(
        `Pinned config cannot be replayed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Ledger writes are best-effort: a sick ledger (full disk, store cap) must
   * degrade to a warning, never break the run it observes.
   */
  private async safeSession<T>(action: string, task: () => Promise<T>): Promise<T | null> {
    try {
      return await task();
    } catch (error) {
      console.warn(
        `[arena] session ledger ${action} failed, continuing run: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Parallel run event stream (holds the global concurrency gate; queued runs can
   * be aborted on client disconnect). Every run opens an execution session first
   * and closes it when the stream settles, so runs stay queryable after disconnect.
   *
   * @param request Validated run request (malformed shapes fall back, never throw here).
   * @param options AbortSignal for client disconnect (aborted runs land cancelled).
   * @yields ArenaEvents from every column plus terminal completion; failures converge
   *   into error events and rethrow after the ledger fail row.
   */
  async *run(request: ArenaRunRequest, options: { signal?: AbortSignal } = {}): AsyncGenerator<ArenaEvent> {
    // Direct callers bypass route validation: fall back instead of throwing on
    // malformed requests (the store still rejects a blank title, never silently).
    const question = typeof request?.question === "string" ? request.question.replace(/\s+/g, " ").trim() : "";
    const session = await this.safeSession("create", () =>
      this.deps.sessions.startSession(
        "arena",
        question === "" ? "arena run" : question.slice(0, 80),
        {
          dimension: typeof request?.dimension === "string" ? request.dimension : "framework",
          selections: Array.isArray(request?.selections) ? request.selections.length : 0,
        },
      ),
    );
    let eventsYielded = 0;
    const collected: ArenaEvent[] = [];
    try {
      const runner = await this.ensureRunner();
      const release = await runner.acquireSlot({ signal: options.signal });
      try {
        for await (const event of runner.streamParallel(request, options)) {
          eventsYielded += 1;
          collected.push(boundedForOutline(event));
          yield event;
        }
      } finally {
        release();
      }
      if (session !== null) {
        // Per-turn outline folded server-side: the ledger keeps a compact
        // turn map without persisting the full event stream.
        const digest = outlineDigest(outlineTurns(collected));
        if (digest.length > 0) {
          await this.safeSession("outline", () =>
            this.deps.sessions.appendEntry(session.id, "note", digest.join("\n")),
          );
        }
        await this.safeSession("complete", () =>
          this.deps.sessions.completeSession(session.id, undefined, { eventsYielded }),
        );
      }
    } catch (error) {
      if (session !== null) {
        // Abort supersedes failure: a user-cancelled run is cancelled, never failed.
        if (options.signal?.aborted) {
          await this.safeSession("cancel", () => this.deps.sessions.cancelSession(session.id));
        } else {
          await this.safeSession("fail", () => this.deps.sessions.failSession(session.id, sanitizeErrorMessage(error)));
        }
      }
      throw error;
    }
  }

  listTemplates(): TaskTemplate[] {
    return listTemplates();
  }

  /**
   * Delivers one human answer to a live column's pending ask_user batch.
   *
   * @throws AppError 404 when no live column is waiting on that (agentId, questionId).
   */
  async answerQuestion(agentId: string, questionId: string, answer: string): Promise<void> {
    const runner = await this.ensureRunner();
    if (!runner.answerQuestion(agentId, questionId, answer)) {
      throw AppError.notFound(`No pending question ${questionId} for column ${agentId}`);
    }
  }

  /** Columns currently waiting on the human (agent id + full pending questions). */
  async pendingAsks(): Promise<Array<{ agentId: string; questions: AskUserQuestion[] }>> {
    const runner = await this.ensureRunner();
    return runner.listPendingAsks();
  }

  /**
   * Independently stops one live column (other columns keep running).
   *
   * @throws AppError 404 when no live column matches that agentId.
   */
  async stopColumn(agentId: string): Promise<void> {
    const runner = await this.ensureRunner();
    if (!runner.stopColumn(agentId)) {
      throw AppError.notFound(`No live column ${agentId}`);
    }
  }

  /**
   * Judges one answer per column label with a task template (pure rules, no model).
   *
   * @param templateId Task template id (unknown ids throw).
   * @param answers Column label to final-answer text.
   * @returns Template response with per-column verdicts.
   */
  judge(templateId: string, answers: Record<string, string>): JudgeResponse {
    const template = getTemplate(templateId);
    if (template === undefined) {
      throw AppError.notFound(`Template not found: ${templateId}`);
    }
    // No cast: the AnswerJudge port already returns Record<string, JudgeResult>.
    const results = this.deps.answerJudge.judgeAnswers(answers, template.judge);
    return {
      template_id: template.id,
      template_name: template.name,
      judge_type: template.judge.type,
      results,
    };
  }

  /**
   * Async judging: deterministic types use the sync port; llm types use the
   * bound async port when wired, otherwise fall back to the sync fail-closed
   * verdict (never throws for missing wiring — the verdict explains it).
   */
  async judgeAsync(templateId: string, answers: Record<string, string>): Promise<JudgeResponse> {
    const template = getTemplate(templateId);
    if (template === undefined) {
      throw AppError.notFound(`Template not found: ${templateId}`);
    }
    if (template.judge.type !== "llm" || this.deps.answerJudge.judgeAnswersAsync === undefined) {
      return this.judge(templateId, answers);
    }
    const results = await this.deps.answerJudge.judgeAnswersAsync(answers, template.judge, {
      question: template.question,
    });
    return {
      template_id: template.id,
      template_name: template.name,
      judge_type: template.judge.type,
      results,
    };
  }
}
