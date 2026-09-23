/**
 * @file arena
 * @description Core Arena API contracts: run config, overrides, schemas, templates, report.
 *
 * Responsibilities:
 * - Define PipelineConfig, baseline overrides, and chat message schemas
 * - Define run/meta/judge request-response schemas
 * - Define task templates and the comparison report structure
 */

import { z } from "zod";
import { DEFAULT_MODEL_ID } from "./provider.js";
import { DECODE_FIELD_RANGES, isUnlimitedSteps, UNLIMITED_STEPS } from "./decode-options.js";
import {
  ApprovalModeSchema,
  ContextStrategySchema,
  DimensionIdSchema,
  HarnessLevelSchema,
  HistoryModeSchema,
  McpPolicySchema,
  MemoryPolicySchema,
  OrchestrationModeSchema,
  PromptProfileSchema,
  ReasoningModeSchema,
  SandboxModeSchema,
  SkillPolicySchema,
  ThinkingLevelSchema,
  ToolsetIdSchema,
} from "./enums.js";
import { PipelineMetricsSchema, TokenStatsSchema } from "./events.js";
import { ToolRoundSchema, type ToolRound } from "./history-mode.js";

/** Total character budget over chat history plus the current question (one shared source for backend validation and frontend trimming). */
export const MAX_HISTORY_CHARS = 24_000;

/** Per-session message cap (one shared source: backend zod caps and the frontend trimmer must stay identical). */
export const MAX_COLUMN_SESSION_MESSAGES = 24;

/** Minimum number of selected options per comparison (one shared source for route validation and the meta contract). Single-column runs are allowed for debugging; the UI may also sit at zero selections (empty state, run disabled). */
export const ARENA_MIN_SELECT = 1;

/** Truncation limit for tool output in observation events (one shared source for the native driver and astream event translation). */
export const OBSERVATION_MAX_CHARS = 8_000;

/** Full run configuration of one column (one comparison variant).
 * Backend event fields use the `pipeline` naming; frontend column state uses `Column` —
 * same concept, do not introduce a third term such as Adapter.
 */
export const PipelineConfigSchema = z.object({
  framework: z.string().default("native"),
  reasoning: ReasoningModeSchema.default("react"),
  context: ContextStrategySchema.default("sliding"),
  harness: HarnessLevelSchema.default("bare"),
  prompt_profile: PromptProfileSchema.default("zero_shot"),
  endpoint_id: z.string().default(""),
  model_id: z.string().default(DEFAULT_MODEL_ID),
  temperature: z.number().default(0.0),
  top_p: z.number().default(1.0),
  frequency_penalty: z.number().default(0.0),
  presence_penalty: z.number().default(0.0),
  max_output_tokens: z.number().int().min(64).max(128_000).default(96000),
  thinking_level: ThinkingLevelSchema.default("off"),
  thinking_capable: z.boolean().default(false),
  // -1 (UNLIMITED_STEPS) means "no step budget": the loop runs until the model
  // stops calling tools or the run is aborted.
  max_steps: z
    .number()
    .int()
    .refine((v) => isUnlimitedSteps(v) || (v >= DECODE_FIELD_RANGES.max_steps.min && v <= DECODE_FIELD_RANGES.max_steps.max), {
      message: `max_steps must be ${UNLIMITED_STEPS} (unlimited) or between ${DECODE_FIELD_RANGES.max_steps.min} and ${DECODE_FIELD_RANGES.max_steps.max}`,
    })
    .default(10),
  toolset: ToolsetIdSchema.default("full"),
  mcp_policy: McpPolicySchema.default("off"),
  skill_policy: SkillPolicySchema.default("on_demand"),
  approval_mode: ApprovalModeSchema.default("auto"),
  sandbox_mode: SandboxModeSchema.default("off"),
  orchestration: OrchestrationModeSchema.default("direct"),
  memory: MemoryPolicySchema.default("none"),
  /** Cross-turn history replay mode; minimal keeps the legacy bare Q/A transcript. */
  history_mode: HistoryModeSchema.default("minimal"),
  prompt_version: z.string().default("v1.0.0"),
  /** Column display label; display plus per-turn aggregation key, not a stable cross-system identity (use agentId/runId). */
  label: z.string().default(""),
});
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

/**
 * Baseline overrides on the wire: option tokens (strings), matching
 * `baseline_defaults` / baseline select values from /meta.
 * Numeric fields are coerced later by `resolveBaselineOverrides`.
 */
export const BaselineOverridesSchema = z.object({
  framework: z.string().nullish(),
  reasoning: ReasoningModeSchema.nullish(),
  context: ContextStrategySchema.nullish(),
  harness: HarnessLevelSchema.nullish(),
  prompt_profile: PromptProfileSchema.nullish(),
  temperature: z.string().nullish(),
  endpoint_id: z.string().nullish(),
  model_id: z.string().nullish(),
  thinking_level: ThinkingLevelSchema.nullish(),
  top_p: z.string().nullish(),
  frequency_penalty: z.string().nullish(),
  presence_penalty: z.string().nullish(),
  max_output_tokens: z.string().nullish(),
  max_steps: z.string().nullish(),
  toolset: ToolsetIdSchema.nullish(),
  mcp_policy: McpPolicySchema.nullish(),
  skill_policy: SkillPolicySchema.nullish(),
  approval_mode: ApprovalModeSchema.nullish(),
  sandbox_mode: SandboxModeSchema.nullish(),
  orchestration: OrchestrationModeSchema.nullish(),
  memory: MemoryPolicySchema.nullish(),
  history_mode: HistoryModeSchema.nullish(),
  /** Column label override: pins the pipeline aggregation key for single-column callers (e.g. threads). */
  label: z.string().max(96).nullish(),
});
export type BaselineOverridesInput = z.input<typeof BaselineOverridesSchema>;
export type BaselineOverrides = z.infer<typeof BaselineOverridesSchema>;

/**
 * Total char budget for the captured tool rounds riding on one request's chat
 * history (summed over all messages with the same accounting as the check
 * below; independent of the Q/A history budgets).
 */
export const MAX_TOOL_ROUNDS_CHARS = 32_000;

/** Per-message cap on captured tool rounds (one shared source for the zod cap and the client-side clamp). */
export const MAX_TOOL_ROUNDS_PER_MESSAGE = 64;

/** Chat history message. Assistant entries may carry the turn's captured tool rounds for history-mode replay. */
export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
  tool_rounds: z.array(ToolRoundSchema).max(MAX_TOOL_ROUNDS_PER_MESSAGE).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** Wire accounting for one round, shared by the history check below and the client-side clamp. */
export function toolRoundChars(round: ToolRound): number {
  return round.tool.length + JSON.stringify(round.args ?? {}).length + round.result.length;
}

/**
 * Clamps captured rounds to the wire caps (MAX_TOOL_ROUNDS_PER_MESSAGE entries,
 * MAX_TOOL_ROUNDS_CHARS chars summed with toolRoundChars accounting), keeping
 * the newest rounds. The client transcript is both the capture store and the
 * wire payload, so it must clamp here; server stores are trimmed by their own
 * caps instead.
 */
export function clampToolRoundsForWire(rounds: ToolRound[]): ToolRound[] {
  const kept: ToolRound[] = [];
  let total = 0;
  for (let i = rounds.length - 1; i >= 0 && kept.length < MAX_TOOL_ROUNDS_PER_MESSAGE; i -= 1) {
    const round = rounds[i] as ToolRound;
    const size = toolRoundChars(round);
    if (size > MAX_TOOL_ROUNDS_CHARS || total + size > MAX_TOOL_ROUNDS_CHARS) break;
    kept.unshift(round);
    total += size;
  }
  return kept;
}

/**
 * Per-column session: that column's own transcript and disk workspace.
 * Keys are pipeline labels (the same aggregation key as ArenaEvent.pipeline).
 */
export const ColumnSessionSchema = z.object({
  workspace: z.string().min(1).max(96).optional(),
  messages: z.array(ChatMessageSchema).max(MAX_COLUMN_SESSION_MESSAGES).default([]),
});
export type ColumnSession = z.infer<typeof ColumnSessionSchema>;

function addChatHistoryIssues(
  messages: ChatMessage[],
  question: string,
  ctx: z.RefinementCtx,
  pathPrefix: Array<string | number>,
): void {
  if (messages.length % 2 !== 0) {
    ctx.addIssue({
      code: "custom",
      message: "Chat history must alternate user/assistant and have an even length",
      path: pathPrefix,
    });
    return;
  }
  for (let i = 0; i < messages.length; i += 1) {
    const expected = i % 2 === 0 ? "user" : "assistant";
    const actual = messages[i]?.role;
    if (actual !== expected) {
      ctx.addIssue({
        code: "custom",
        message: `Chat history message ${i + 1} must be ${expected}, got ${actual}`,
        path: [...pathPrefix, i],
      });
      return;
    }
  }
  const historyChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (historyChars + question.length > MAX_HISTORY_CHARS) {
    ctx.addIssue({
      code: "custom",
      message: `Chat history plus question exceeds the limit (${MAX_HISTORY_CHARS} characters)`,
      path: pathPrefix,
    });
  }
  const roundsChars = messages.reduce(
    (sum, m) => sum + (m.tool_rounds ?? []).reduce((acc, round) => acc + toolRoundChars(round), 0),
    0,
  );
  if (roundsChars > MAX_TOOL_ROUNDS_CHARS) {
    ctx.addIssue({
      code: "custom",
      message: `Tool rounds exceed the limit (${MAX_TOOL_ROUNDS_CHARS} characters)`,
      path: pathPrefix,
    });
  }
}

/** One client-attached file seeded into every participating column's workspace. */
export const RunAttachmentSchema = z.object({
  /**
   * Path-safe relative name inside the workspace (single segment or nested path).
   * Traversal is rejected here at the boundary (422), not left to the workspace
   * write path: names must not be absolute, contain backslashes, or include
   * empty/dot/dot-dot segments.
   */
  name: z
    .string()
    .min(1)
    .max(200)
    .refine((name) => {
      if (name.startsWith("/") || /^[a-zA-Z]:([/]|$)/.test(name) || name.includes("\\")) return false;
      return name
        .split("/")
        .every((segment) => segment !== "" && segment !== "." && segment !== "..");
    }, "Attachment name must be a relative path without traversal"),
  /** UTF-8 text content; binary attachments are rejected by the client before submit. */
  content: z.string().max(64 * 1024),
});
export type RunAttachment = z.infer<typeof RunAttachmentSchema>;

/** Starts one comparison experiment run. */
export const ArenaRunRequestSchema = z
  .object({
    question: z.string().min(1).max(4000),
    dimension: DimensionIdSchema.default("framework"),
    selections: z.array(z.string()).max(16).default([]),
    temperature: z.number().min(0).max(2).nullish(),
    baseline: BaselineOverridesSchema.nullish(),
    /** Fallback transcript when a column has no entry in column_sessions (legacy clients). */
    messages: z.array(ChatMessageSchema).max(MAX_COLUMN_SESSION_MESSAGES).default([]),
    /**
     * Independent per-column sessions. When present, each column continues from
     * its own messages and reuses its own workspace; shared `messages` is only
     * the fallback for columns missing from this map.
     */
    column_sessions: z.record(z.string().min(1).max(200), ColumnSessionSchema).optional(),
    /** Files seeded into newly created column workspaces before the run starts. */
    attachments: z.array(RunAttachmentSchema).max(5).optional(),
    /**
     * Live ask_user channel: when true, columns may block on POST /api/arena/answer
     * until the human replies (bounded wait, then headless defer). Unattended callers
     * keep the default false and never block.
     */
    interactive: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    addChatHistoryIssues(value.messages, value.question, ctx, ["messages"]);
    const sessions = value.column_sessions;
    if (sessions === undefined) return;
    const labels = Object.keys(sessions);
    if (labels.length > 16) {
      ctx.addIssue({ code: "custom", message: "Too many column sessions", path: ["column_sessions"] });
      return;
    }
    for (const label of labels) {
      const session = sessions[label];
      if (session === undefined) continue;
      addChatHistoryIssues(session.messages, value.question, ctx, ["column_sessions", label, "messages"]);
    }
  });
export type ArenaRunRequest = z.infer<typeof ArenaRunRequestSchema>;

/** Dimension option (field + value determine the field overridden for a column). */
export const DimensionOptionSchema = z.object({
  field: z.string(),
  value: z.string(),
  label: z.string(),
});
export type DimensionOption = z.infer<typeof DimensionOptionSchema>;

/** Dimension metadata (the option list /meta returns to the frontend). */
export const DimensionMetaSchema = z.object({
  id: DimensionIdSchema,
  label: z.string(),
  subtitle: z.string(),
  options: z.array(DimensionOptionSchema),
  min_select: z.number().int(),
  max_select: z.number().int(),
});
export type DimensionMeta = z.infer<typeof DimensionMetaSchema>;

export const BaselineFieldOptionSchema = z.object({ value: z.string(), label: z.string() });
export type BaselineFieldOption = z.infer<typeof BaselineFieldOptionSchema>;

/** Baseline-configurable field (dimension === null means baseline-only, not a comparison dimension). */
export const BaselineFieldSchema = z.object({
  dimension: DimensionIdSchema.nullable(),
  field: z.string(),
  label: z.string(),
  group: z.string(),
  default: z.string(),
  options: z.array(BaselineFieldOptionSchema),
  /** Editor kind: number fields render a validated numeric input instead of a dropdown. */
  input: z.enum(["select", "number"]).default("select"),
  /** Valid range/step for number inputs (null when input is select). */
  min: z.number().nullish(),
  max: z.number().nullish(),
  step: z.number().nullish(),
  /** Number fields may also be set to "unlimited" (max_steps: no step budget). */
  allow_unlimited: z.boolean().nullish(),
});
export type BaselineField = z.infer<typeof BaselineFieldSchema>;

/** Framework adapter descriptor. */
export const FrameworkDescriptorSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["available", "reserved"]),
});
export type FrameworkDescriptor = z.infer<typeof FrameworkDescriptorSchema>;

/** GET /api/arena/meta response. */
export const ArenaMetaSchema = z.object({
  dimensions: z.array(DimensionMetaSchema),
  frameworks: z.array(FrameworkDescriptorSchema),
  baseline_defaults: z.record(z.string(), z.string()),
  baseline_fields: z.array(BaselineFieldSchema),
  model_compare_ready: z.boolean(),
});
export type ArenaMeta = z.infer<typeof ArenaMetaSchema>;

/** Auto-judging rule. Fields form a union; the ones used depend on `type`. */
export const JudgeSpecSchema = z.object({
  type: z.enum(["keyword", "json", "code", "numeric", "exclude", "regex", "none", "llm"]),
  any_of: z.array(z.string()).default([]),
  all_of: z.array(z.string()).default([]),
  min_hits: z.number().int().min(1).default(1),
  required_fields: z.array(z.string()).default([]),
  must_contain: z.array(z.string()).default([]),
  max_len: z.number().int().min(1).default(8000),
  operator: z.enum(["==", ">=", "<=", ">", "<"]).default("=="),
  value: z.number().default(0.0),
  tolerance: z.number().min(0).default(0.0),
  patterns: z.array(z.string()).default([]),
  pattern: z.string().default(""),
  /** LLM judge rubric (used only when type is llm; empty = generic accuracy/completeness). */
  rubric: z.string().default(""),
  /** LLM judge pass threshold over the 0-1 score (used only when type is llm). */
  passing_score: z.number().min(0).max(1).default(0.5),
  /** Preferred judge model id (empty = host default; advisory only). */
  judge_model: z.string().default(""),
});
export type JudgeSpec = z.infer<typeof JudgeSpecSchema>;

/** Per-column judging result. */
export const JudgeResultSchema = z.object({
  passed: z.boolean(),
  reason: z.string(),
  details: z.array(z.string()),
});
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

/** Task template (preset question + suggested dimension + judging rule). */
export const TaskTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  question: z.string(),
  suggested_dimension: DimensionIdSchema,
  suggested_selections: z.array(z.string()),
  judge: JudgeSpecSchema,
  category: z.enum(["scored", "quick"]).default("scored"),
});
export type TaskTemplate = z.infer<typeof TaskTemplateSchema>;

/** POST /api/arena/judge request. */
export const JudgeRequestSchema = z
  .object({
    template_id: z.string().min(1).max(100),
    answers: z.record(z.string(), z.string()),
  })
  .refine((value) => Object.keys(value.answers).length <= 16, {
    message: "Too many answers",
  });
export type JudgeRequest = z.infer<typeof JudgeRequestSchema>;

/** One matrix cell: a template comparison with optional routing overrides. */
export const MatrixCellSchema = z.object({
  template_id: z.string().min(1).max(100),
  dimension: DimensionIdSchema.nullish(),
  selections: z.array(z.string()).max(16).default([]),
  baseline: BaselineOverridesSchema.nullish(),
});
export type MatrixCell = z.infer<typeof MatrixCellSchema>;

/** POST /api/arena/matrix request: up to 32 template cells, run sequentially (the scored template set is 15 today). */
export const MatrixRequestSchema = z.object({
  cells: z.array(MatrixCellSchema).min(1).max(32),
});
export type MatrixRequest = z.infer<typeof MatrixRequestSchema>;

/** POST /api/arena/answer request: answers one pending ask_user question of a live column. */
export const ArenaAnswerRequestSchema = z.object({
  /** Asking column's stable identity (carried on every arena event). */
  agent_id: z.string().min(1).max(128),
  /** Model-provided question id echoed from the ask_user action args. */
  question_id: z.string().min(1).max(64),
  /** The human's answer; an empty string means "skip, proceed without me". */
  answer: z.string().max(4_000).default(""),
});
export type ArenaAnswerRequest = z.infer<typeof ArenaAnswerRequestSchema>;

/** POST /api/arena/stop-column request: independently stops one live column (other columns keep running). */
export const ArenaStopColumnRequestSchema = z.object({
  /** Running column's stable identity (carried on every arena event as agentId). */
  agent_id: z.string().min(1).max(128),
});
export type ArenaStopColumnRequest = z.infer<typeof ArenaStopColumnRequestSchema>;

/** Per-cell progress over SSE (final cell state arrives with the report). */
export const MatrixProgressSchema = z.object({
  template_id: z.string(),
  status: z.enum(["started", "scored", "failed"]),
  score: z.string().default(""),
  error: z.string().default(""),
});
export type MatrixProgress = z.infer<typeof MatrixProgressSchema>;

/** One ablation row: how a column actually behaved (tool profile, judge verdict). */
export const AblationRowSchema = z.object({
  label: z.string(),
  tool_calls: z.number(),
  mcp_calls: z.number(),
  mcp_share: z.number(),
  skill_reads: z.number(),
  delegations: z.number(),
  reflects: z.number(),
  observation_chars: z.number(),
  answer_chars: z.number(),
  judge_passed: z.boolean().nullable(),
  trajectory_score: z.number().min(0).max(1).nullable().default(null),
  success: z.boolean(),
});
export type AblationRow = z.infer<typeof AblationRowSchema>;

/** Summed hard metrics for one matrix cell (null when the run published none). */
export const MatrixCellMetricsSchema = z.object({
  total_tokens: z.number(),
  tool_calls: z.number(),
  steps: z.number(),
});
export type MatrixCellMetrics = z.infer<typeof MatrixCellMetricsSchema>;

/** One scored matrix cell in the final report. */
export const MatrixCellResultSchema = z.object({
  template_id: z.string(),
  dimension: z.string(),
  selections: z.array(z.string()),
  judge_type: z.string(),
  score: z.object({ passed: z.number(), total: z.number() }),
  columns: z.record(z.string(), z.boolean()),
  /** Summed column metrics from the run report (absent when unpublished). */
  metrics: MatrixCellMetricsSchema.nullish(),
  /** Behavior-ablation rows from the run report (absent when unpublished). */
  ablation: z.array(AblationRowSchema).nullish(),
});
export type MatrixCellResult = z.infer<typeof MatrixCellResultSchema>;

/** Final matrix report (last SSE event of a matrix run). */
export const MatrixReportSchema = z.object({
  cells: z.array(MatrixCellResultSchema),
  startedAt: z.number(),
  finishedAt: z.number(),
});
export type MatrixReport = z.infer<typeof MatrixReportSchema>;

/** One dimension evaluated along the execution trajectory. */
export const TrajectoryDimensionScoreSchema = z.object({
  dimension: z.string(),
  score: z.number().min(0).max(1),
  weight: z.number().min(0).max(1).default(0.25),
  reason: z.string(),
  evidence: z.array(z.string()).default([]),
});
export type TrajectoryDimensionScore = z.infer<typeof TrajectoryDimensionScoreSchema>;

/** Overall trajectory evaluation for one pipeline run. */
export const TrajectoryScoreSchema = z.object({
  overall: z.number().min(0).max(1),
  passed: z.boolean(),
  dimensions: z.record(z.string(), TrajectoryDimensionScoreSchema),
  summary: z.string(),
});
export type TrajectoryScore = z.infer<typeof TrajectoryScoreSchema>;

/** POST /api/arena/judge response. */
export const JudgeResponseSchema = z.object({
  template_id: z.string(),
  template_name: z.string(),
  judge_type: JudgeSpecSchema.shape.type,
  results: z.record(z.string(), JudgeResultSchema),
});
export type JudgeResponse = z.infer<typeof JudgeResponseSchema>;

/** Hard-metric row of a comparison report. */
export const HardMetricRowSchema = z.object({
  label: z.string(),
  duration_ms: z.number(),
  total_tokens: z.number(),
  tool_calls: z.number(),
  steps: z.number(),
  success: z.boolean(),
});
export type HardMetricRow = z.infer<typeof HardMetricRowSchema>;

/** Per-column artifacts and step summary. */
export const ColumnReportSchema = z.object({
  metrics: PipelineMetricsSchema.nullable(),
  artifacts: z.object({
    files: z.array(z.string()).optional(),
    file_count: z.number().optional(),
    tree: z.string().optional(),
    snippets: z.record(z.string(), z.string()).optional(),
  }),
  steps: z.string().optional(),
  workspace: z.string().optional(),
  /** Trajectory evaluation score (optional, populated when trajectory judging runs). */
  trajectory: TrajectoryScoreSchema.nullish(),
});
export type ColumnReport = z.infer<typeof ColumnReportSchema>;

/** Comparison report structure carried in the content of a report event. */
export const ComparisonReportSchema = z.object({
  dimension: z.string(),
  question: z.string(),
  hard_metrics: z.object({ rows: z.array(HardMetricRowSchema) }),
  columns: z.record(z.string(), ColumnReportSchema),
  narrative: z.string(),
  /** Ablation rows (absent for reports built without judging inputs). */
  ablation: z.object({ rows: z.array(AblationRowSchema) }).optional(),
  /** Trajectory evaluation scores keyed by column label. */
  trajectories: z.record(z.string(), TrajectoryScoreSchema).optional(),
});
export type ComparisonReport = z.infer<typeof ComparisonReportSchema>;
