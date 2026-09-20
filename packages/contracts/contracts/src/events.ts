/**
 * @file events
 * @description Run event contracts: the discriminated union of all business events.
 *
 * Responsibilities:
 * - Define the ArenaEvent union flowing runtime to transport to web
 * - Provide factory helpers for system-level and column-level events
 */

import { z } from "zod";

/** Run event types: one shared enum for all business events. */
export const EventTypeSchema = z.enum([
  "thought",
  "thought_delta",
  "thought_end",
  "step_start",
  "action",
  "observation",
  "tool_progress",
  "file_diff",
  "verify",
  "reflect",
  "harness_edit",
  "report",
  "complete",
  "error",
  "token_update",
  "thinking",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

/** Token usage stats (carried by token_update / complete events). */
export const TokenStatsSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  total_tokens: z.number(),
  context_window: z.number(),
  max_input_tokens: z.number(),
  max_output_tokens: z.number(),
  context_usage_pct: z.number(),
  input_usage_pct: z.number(),
});
export type TokenStats = z.infer<typeof TokenStatsSchema>;

/** Hard-metric summary of a single column run (carried by the complete event). */
export const PipelineMetricsSchema = z.object({
  success: z.boolean(),
  duration_ms: z.number().int(),
  input_tokens: z.number().default(0),
  output_tokens: z.number().default(0),
  total_tokens: z.number().default(0),
  tool_calls: z.number().default(0),
  steps: z.number().default(0),
  context_window: z.number().default(128_000),
  max_input_tokens: z.number().default(120_000),
  max_output_tokens: z.number().default(96000),
  context_usage_pct: z.number().default(0.0),
  input_usage_pct: z.number().default(0.0),
});
export type PipelineMetrics = z.infer<typeof PipelineMetricsSchema>;

/**
 * Common fields of run events.
 * `pipeline` is both the display column label and the aggregation key for events
 * and reports (producers must keep it unique within a run turn);
 * `agentId` is a stable identity field for cross-system tracing of one generation
 * and is deliberately not an aggregation key.
 */
const ArenaEventBase = z.object({
  pipeline: z.string(),
  workspace: z.string().default(""),
  content: z.string().default(""),
  tool: z.string().default(""),
  args: z.record(z.string(), z.unknown()).default({}),
  result: z.string().default(""),
  step: z.number().int().default(0),
  passed: z.boolean().nullable(),
  reason: z.string().default(""),
  metrics: PipelineMetricsSchema.nullable(),
  message: z.string().default(""),
  token_stats: TokenStatsSchema.nullable(),
  /** 1-based multi-turn turn number; 0 means unannotated (the agent layer backfills it). */
  turn: z.number().int().min(0).max(64).default(0),
  /** Stable id of the owning run; empty for system-level events. */
  runId: z.string().default(""),
  /** Event production time (ms epoch; injected by the runner's Clock). */
  timestamp: z.number().int().default(0),
  /** Stable run identity; display label drift does not affect event attribution. */
  agentId: z.string().optional(),
});

function variant<T extends "thought" | "thought_delta" | "thought_end" | "step_start" | "action" | "observation" | "tool_progress" | "file_diff" | "verify" | "reflect" | "harness_edit" | "report" | "complete" | "error" | "token_update" | "thinking">(type: T) {
  return ArenaEventBase.extend({ type: z.literal(type) });
}

/** token_update always carries the full token stats. */
const TokenUpdateVariant = variant("token_update").extend({ token_stats: TokenStatsSchema });

/** Runtime event stream: the unified event model from runtime through transport to the frontend. */
export const ArenaEventSchema = z.discriminatedUnion("type", [
  variant("thought"),
  variant("thought_delta"),
  variant("thought_end"),
  // Emitted the moment a driver starts one LLM call, before the first token: keeps
  // the column visibly alive while a buffering provider stays silent
  variant("step_start"),
  variant("action"),
  variant("observation"),
  variant("tool_progress"),
  // file_diff is emitted after write/edit tools succeed (all drivers; Native, LangChain, LangGraph)
  variant("file_diff"),
  variant("verify"),
  variant("reflect"),
  variant("harness_edit"),
  variant("report"),
  variant("complete"),
  variant("error"),
  TokenUpdateVariant,
  variant("thinking"),
]);
export type ArenaEvent = z.infer<typeof ArenaEventSchema>;

/** Builds a system-level error event (route failures, in-stream exceptions, etc. with no column attribution), shared by runner and transport. */
export function systemErrorEvent(message: string, timestamp = 0): ArenaEvent {
  return {
    type: "error",
    pipeline: "system",
    workspace: "",
    content: "",
    tool: "",
    args: {},
    result: "",
    step: 0,
    passed: null,
    reason: "",
    metrics: null,
    message,
    token_stats: null,
    turn: 0,
    runId: "",
    timestamp,
  };
}

/** Builds a system-level report event (the comparison report payload at the SSE tail). */
export function systemReportEvent(fields: { content: string; runId?: string; timestamp?: number }): ArenaEvent {
  return {
    type: "report",
    pipeline: "system",
    workspace: "",
    content: fields.content,
    tool: "",
    args: {},
    result: "",
    step: 0,
    passed: null,
    reason: "",
    metrics: null,
    message: "",
    token_stats: null,
    turn: 0,
    runId: fields.runId ?? "",
    timestamp: fields.timestamp ?? 0,
  };
}

/** Builds a token_update event (counters are produced by the caller's metering primitives; the contract only defines the event shape and identity fields). */
export function tokenUpdateEvent(fields: {
  pipeline: string;
  token_stats: TokenStats;
  workspace?: string;
  turn?: number;
  runId?: string;
  agentId?: string;
  timestamp?: number;
}): ArenaEvent {
  return {
    type: "token_update",
    pipeline: fields.pipeline,
    workspace: fields.workspace ?? "",
    token_stats: fields.token_stats,
    content: "",
    tool: "",
    args: {},
    result: "",
    step: 0,
    passed: null,
    reason: "",
    metrics: null,
    message: "",
    turn: fields.turn ?? 0,
    runId: fields.runId ?? "",
    timestamp: fields.timestamp ?? 0,
    agentId: fields.agentId,
  };
}

/** Builds a complete event (token_stats defaults to a derivation from metrics to avoid two accounting standards). */
export function completeEvent(fields: {
  pipeline: string;
  metrics: PipelineMetrics;
  token_stats?: TokenStats | null;
  workspace?: string;
  turn?: number;
  runId?: string;
  agentId?: string;
  timestamp?: number;
}): ArenaEvent {
  return {
    type: "complete",
    pipeline: fields.pipeline,
    workspace: fields.workspace ?? "",
    metrics: fields.metrics,
    token_stats: fields.token_stats === undefined ? tokenStatsFromMetrics(fields.metrics) : fields.token_stats,
    content: "",
    tool: "",
    args: {},
    result: "",
    step: 0,
    passed: null,
    reason: "",
    message: "",
    turn: fields.turn ?? 0,
    runId: fields.runId ?? "",
    timestamp: fields.timestamp ?? 0,
    agentId: fields.agentId,
  };
}

function tokenStatsFromMetrics(metrics: PipelineMetrics): TokenStats {
  return {
    input_tokens: metrics.input_tokens,
    output_tokens: metrics.output_tokens,
    total_tokens: metrics.total_tokens,
    context_window: metrics.context_window,
    max_input_tokens: metrics.max_input_tokens,
    max_output_tokens: metrics.max_output_tokens,
    context_usage_pct: metrics.context_usage_pct,
    input_usage_pct: metrics.input_usage_pct,
  };
}

/** Builds a column-level error event (shared convergence point for driver and runner failures, avoiding full literal duplication). */
export function arenaErrorEvent(fields: {
  pipeline: string;
  workspace?: string;
  message: string;
  turn?: number;
  runId?: string;
  timestamp?: number;
  agentId?: string;
}): ArenaEvent {
  return {
    type: "error",
    pipeline: fields.pipeline,
    workspace: fields.workspace ?? "",
    content: "",
    tool: "",
    args: {},
    result: "",
    step: 0,
    passed: null,
    reason: "",
    metrics: null,
    message: fields.message,
    token_stats: null,
    turn: fields.turn ?? 0,
    runId: fields.runId ?? "",
    timestamp: fields.timestamp ?? 0,
    agentId: fields.agentId,
  };
}
