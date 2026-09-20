/**
 * @file matrix-service
 * @description Template × dimension matrix runs over the arena use cases.
 *
 * Responsibilities:
 * - Run matrix cells sequentially through ArenaService (run + judge each)
 * - Stream per-cell progress and finish with one matrix report
 * - Extract answers via the contracts-level projection (extractAnswerFromEvents)
 *
 * Cells run sequentially: the runner's global concurrency gate already bounds
 * parallelism, and sequential cells keep progress reporting total. A failing
 * cell records failed progress and continues with the next cell; only a
 * client abort stops the matrix early.
 */

import {
  ComparisonReportSchema,
  extractAnswerFromEvents,
  sanitizeErrorMessage,
  type ArenaEvent,
  type MatrixCell,
  type MatrixCellMetrics,
  type MatrixCellResult,
  type MatrixReport,
} from "@agentprism/contracts";
import type { ArenaService } from "./arena-service.js";

export interface MatrixServiceDeps {
  arena: ArenaService;
  /** Clock for report timestamps. */
  now: () => number;
}

/** Matrix stream item: progress per cell, then exactly one final report. */
export type MatrixStreamItem =
  | { kind: "progress"; template_id: string; status: "started" | "scored" | "failed"; score: string; error: string }
  | { kind: "report"; report: MatrixReport };

/** Template × dimension matrix use cases. */
export class MatrixService {
  private readonly deps: MatrixServiceDeps;

  constructor(deps: MatrixServiceDeps) {
    this.deps = deps;
  }

  /**
   * Runs every cell and yields progress plus one final report.
   * Unknown template ids fail their cell loudly (no throw across cells).
   */
  async *runMatrix(
    cells: MatrixCell[],
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<MatrixStreamItem> {
    const startedAt = this.deps.now();
    const results: MatrixCellResult[] = [];
    for (const cell of cells) {
      if (options.signal?.aborted) break;
      yield { kind: "progress", template_id: cell.template_id, status: "started", score: "", error: "" };
      try {
        results.push(await this.runCell(cell, options.signal));
        const last = results[results.length - 1] as MatrixCellResult;
        yield {
          kind: "progress",
          template_id: cell.template_id,
          status: "scored",
          score: `${last.score.passed}/${last.score.total}`,
          error: "",
        };
      } catch (error) {
        if (options.signal?.aborted) break;
        yield {
          kind: "progress",
          template_id: cell.template_id,
          status: "failed",
          score: "",
          error: sanitizeErrorMessage(error).slice(0, 300),
        };
      }
    }
    yield {
      kind: "report",
      report: { cells: results, startedAt, finishedAt: this.deps.now() },
    };
  }

  private async runCell(cell: MatrixCell, signal?: AbortSignal): Promise<MatrixCellResult> {
    const template = this.deps.arena.listTemplates().find((candidate) => candidate.id === cell.template_id);
    if (template === undefined) {
      throw new Error(`Template not found: ${cell.template_id}`);
    }
    const dimension = cell.dimension ?? template.suggested_dimension;
    const selections = cell.selections.length > 0 ? [...cell.selections] : [...template.suggested_selections];
    const events: ArenaEvent[] = [];
    for await (const event of this.deps.arena.run(
      {
        question: template.question,
        dimension,
        selections,
        baseline: cell.baseline ?? undefined,
        messages: [],
        // Matrix cells run unattended: ask_user keeps its headless defer path.
        interactive: false,
      },
      { signal },
    )) {
      events.push(event);
    }
    const byLabel = new Map<string, ArenaEvent[]>();
    for (const event of events) {
      if (event.pipeline === "") continue;
      const list = byLabel.get(event.pipeline) ?? [];
      list.push(event);
      byLabel.set(event.pipeline, list);
    }
    const answers: Record<string, string> = {};
    for (const [label, list] of byLabel) answers[label] = extractAnswerFromEvents(list);
    const judged = this.deps.arena.judge(template.id, answers);
    const columns: Record<string, boolean> = {};
    let passed = 0;
    for (const [label, verdict] of Object.entries(judged.results)) {
      columns[label] = verdict.passed;
      if (verdict.passed) passed += 1;
    }
    return {
      template_id: template.id,
      dimension,
      selections,
      judge_type: judged.judge_type,
      score: { passed, total: Object.keys(judged.results).length },
      columns,
      ...MatrixService.summarizeReport(events),
    };
  }

  /**
   * Summarizes the run tail report (metrics sums + ablation rows) for one cell.
   * Missing or malformed reports yield empty summaries (never throw: the cell
   * score already stands on its own).
   */
  private static summarizeReport(events: ArenaEvent[]): {
    metrics: MatrixCellMetrics | null;
    ablation: MatrixCellResult["ablation"];
  } {
    const empty = { metrics: null, ablation: undefined } as {
      metrics: MatrixCellMetrics | null;
      ablation: MatrixCellResult["ablation"];
    };
    const reportEvent = events.find((event) => event.type === "report");
    if (reportEvent === undefined || typeof reportEvent.content !== "string") return empty;
    let parsed: unknown;
    try {
      parsed = JSON.parse(reportEvent.content);
    } catch {
      return empty;
    }
    const report = ComparisonReportSchema.safeParse(parsed);
    if (!report.success) return empty;
    let totalTokens = 0;
    let toolCalls = 0;
    let steps = 0;
    for (const row of report.data.hard_metrics.rows) {
      totalTokens += row.total_tokens;
      toolCalls += row.tool_calls;
      steps += row.steps;
    }
    return {
      metrics: { total_tokens: totalTokens, tool_calls: toolCalls, steps },
      ablation: report.data.ablation?.rows,
    };
  }
}
