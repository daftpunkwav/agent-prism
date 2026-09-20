/**
 * @file report-publisher
 * @description Port for publishing comparison reports.
 *
 * Responsibilities:
 * - Define the publish input and interface
 *
 * Implementations are injected at the composition root, typically delegating
 * to the evaluation package.
 */

import type { ComparisonReport, PipelineConfig } from "./arena.js";
import type { ArenaEvent, PipelineMetrics } from "./events.js";

/** Input for publishing a comparison report: assembled by the orchestration layer after all columns finish. */
export interface ReportPublishInput {
  request: { dimension: string; question: string };
  configs: PipelineConfig[];
  eventsByPipeline: Record<string, ArenaEvent[]>;
  metricsByPipeline: Record<string, PipelineMetrics | null>;
  signal?: AbortSignal;
}

/** Report publishing port; returning null skips the report (tests or narrative disabled). */
export interface ReportPublisher {
  publish(input: ReportPublishInput): Promise<ComparisonReport | null>;
}
