/**
 * @file column-state
 * @description Frontend view state of a single comparison column.
 *
 * Responsibilities:
 * - Hold the merged display event stream per column
 * - Attach judging and workspace metadata
 *
 * Pure state shape only: no React, no fetching.
 */

import type { ArenaEvent, JudgeResult, PipelineMetrics, TokenStats } from "@agentprism/contracts";

export type ColumnState = {
  label: string;
  /** Framework id for banner filtering; set when the column is created for a run. */
  frameworkId?: string;
  events: ArenaEvent[];
  metrics?: PipelineMetrics;
  tokenStats?: TokenStats;
  workspace?: string;
  error?: string;
  judge?: JudgeResult;
};
