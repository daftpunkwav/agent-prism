/**
 * @file builder
 * @description Agent Builder contracts: block composition, session views, trace entries, stream chunks.
 *
 * Responsibilities:
 * - Define the composition schema: the minimal blocks an agent is assembled from
 * - Define the block catalog, session views, and request/response schemas
 * - Define the trace entry model (LLM wire traffic + session lifecycle) and the SSE chunk union
 *
 * Pure schemas only: no framework, driver, or provider imports. The builder domain
 * package owns behavior; this file is the single wire truth shared with the client.
 */

import { z } from "zod";
import {
  ContextStrategySchema,
  HarnessLevelSchema,
  PromptProfileSchema,
  ReasoningModeSchema,
  ApprovalModeSchema,
  McpPolicySchema,
  MemoryPolicySchema,
  OrchestrationModeSchema,
  SandboxModeSchema,
  SkillPolicySchema,
  ThinkingLevelSchema,
} from "./enums.js";
import { ArenaEventSchema, PipelineMetricsSchema } from "./events.js";
import { RunAttachmentSchema } from "./arena.js";

/** Per-message content cap of the builder chat history (server-side store enforces the same value). */
export const BUILDER_MESSAGE_MAX_CHARS = 12_000;

/** One chat message of a builder session. */
export const BuilderChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(BUILDER_MESSAGE_MAX_CHARS),
  /** 1-based turn this message belongs to (absent on pre-dating and compacted messages). */
  turn: z.number().int().min(1).optional(),
});
export type BuilderChatMessage = z.infer<typeof BuilderChatMessageSchema>;

/**
 * Default tool set for compositions that omit `tools`: file work plus code
 * execution plus planning plus ask_user, so a fresh agent can create projects
 * and read/write files in its workspace out of the box. An explicit empty list
 * stays tool-free (pure chat).
 */
export const DEFAULT_BUILDER_TOOLS: readonly string[] = [
  "read",
  "write",
  "edit",
  "ls",
  "bash",
  "glob",
  "grep",
  "todo_write",
  "ask_user",
];

/**
 * The agent composition: one selection per block slot. Every field is a swappable
 * block; an empty `tools` list means the agent runs with no tool capability at all.
 */
/**
 * Pre-rename shell tool name. Persisted builder compositions may still carry it;
 * map it to "bash" whenever a stored composition is loaded or re-normalized.
 */
export const LEGACY_BASH_TOOL_NAME = "run";

/** Maps pre-rename tool names onto their current names (run -> bash; others pass through). */
export function migrateLegacyToolNames(tools: readonly string[]): string[] {
  return tools.map((name) => (name === LEGACY_BASH_TOOL_NAME ? "bash" : name));
}

export const BuilderCompositionSchema = z.object({
  /** Runtime framework block (driver id, e.g. native / langchain / langgraph). */
  framework: z.string().min(1).max(64).default("native"),
  /** Provider endpoint block (empty = provider default endpoint). */
  endpoint_id: z.string().max(96).default(""),
  /** Model id block (empty = endpoint default model). */
  model_id: z.string().max(128).default(""),
  temperature: z.number().min(0).max(2).default(0.0),
  top_p: z.number().min(0).max(1).default(1.0),
  frequency_penalty: z.number().min(-2).max(2).default(0.0),
  presence_penalty: z.number().min(-2).max(2).default(0.0),
  // Relaxed for file-emitting tasks: a polished single file costs several thousand
  // tokens and 2048 cut every long write mid-stream (rewrite loops). Builder-only.
  max_output_tokens: z.number().int().min(64).max(384_000).default(64_000),
  thinking_level: ThinkingLevelSchema.default("off"),
  /** Tool blocks: explicit tool names; omitted defaults to DEFAULT_BUILDER_TOOLS, the empty list disables the tool system entirely. */
  tools: z.array(z.string().min(1).max(64)).max(32).default([...DEFAULT_BUILDER_TOOLS]),
  context: ContextStrategySchema.default("sliding"),
  prompt_profile: PromptProfileSchema.default("zero_shot"),
  reasoning: ReasoningModeSchema.default("react"),
  harness: HarnessLevelSchema.default("bare"),
  // Relaxed alongside max_output_tokens: plan→write→verify task shapes need more
  // than 10 turns. No hard ceiling: the run abort and max_output bound runaway turns.
  max_steps: z.number().int().min(1).default(200),
  /** Custom system prompt block (empty = the builtin prompt profile). */
  system_prompt: z.string().max(8_000).default(""),
  mcp_policy: McpPolicySchema.default("off"),
  skill_policy: SkillPolicySchema.default("on_demand"),
  orchestration: OrchestrationModeSchema.default("direct"),
  memory: MemoryPolicySchema.default("none"),
  approval_mode: ApprovalModeSchema.default("auto"),
  sandbox_mode: SandboxModeSchema.default("off"),
});
export type BuilderComposition = z.infer<typeof BuilderCompositionSchema>;
export type BuilderCompositionInput = z.input<typeof BuilderCompositionSchema>;
export type BuilderCompositionPatch = z.input<ReturnType<typeof BuilderCompositionSchema.partial>>;

/** One tool call inside an LLM wire payload (id/name/arguments triple). */
export const LlmWireToolCallSchema = z.object({
  id: z.string().default(""),
  name: z.string().default(""),
  args: z.record(z.string(), z.unknown()).default({}),
});
export type LlmWireToolCall = z.infer<typeof LlmWireToolCallSchema>;

/**
 * One message inside a captured LLM request/response. Capture is full fidelity:
 * content is never clipped, and `truncated` stays false today (the field is kept
 * for wire-schema stability; see the provider wire tracer).
 */
export const LlmWireMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().default(""),
  /** Reasoning text extracted from vendor-specific fields (thinking). */
  reasoning: z.string().default(""),
  tool_calls: z.array(LlmWireToolCallSchema).default([]),
  tool_call_id: z.string().default(""),
  name: z.string().default(""),
  truncated: z.boolean().default(false),
});
export type LlmWireMessage = z.infer<typeof LlmWireMessageSchema>;

/** Data payload of an `llm_request` trace entry. */
export const LlmWireRequestSchema = z.object({
  model: z.string().default(""),
  messages: z.array(LlmWireMessageSchema).default([]),
  /** Tool names bound for this call (session-authorized set at call time). */
  tools: z.array(z.string()).default([]),
  /**
   * Vendor invocation parameters for this call (temperature / top_p / penalties /
   * max_tokens / stream / response_format / bound tool definitions as applicable),
   * captured from the SDK's own invocation params with secret-looking keys
   * redacted. This is the proof of what was actually sent, not what was configured.
   */
  params: z.record(z.string(), z.unknown()).default({}),
});
export type LlmWireRequest = z.infer<typeof LlmWireRequestSchema>;

/** Data payload of an `llm_response` trace entry. */
export const LlmWireResponseSchema = z.object({
  model: z.string().default(""),
  text: z.string().default(""),
  reasoning: z.string().default(""),
  tool_calls: z.array(LlmWireToolCallSchema).default([]),
  usage: z
    .object({
      input_tokens: z.number().default(0),
      output_tokens: z.number().default(0),
      total_tokens: z.number().default(0),
    })
    .nullable()
    .default(null),
  finish_reason: z.string().default(""),
  truncated: z.boolean().default(false),
});
export type LlmWireResponse = z.infer<typeof LlmWireResponseSchema>;

/** Data payload of an `llm_error` trace entry. */
export const LlmWireErrorSchema = z.object({
  model: z.string().default(""),
  error: z.string().default(""),
});
export type LlmWireError = z.infer<typeof LlmWireErrorSchema>;

/**
 * One captured LLM wire record before trace-log envelope fields (id/seq/turn) are
 * attached. Producers (providers tracer) and consumers (builder trace log) share
 * this shape; it is a plain interface because it never crosses the wire alone.
 */
export interface LlmWireRecord {
  kind: "llm_request" | "llm_response" | "llm_error";
  title: string;
  data: Record<string, unknown>;
  durationMs: number | null;
}

/** Trace entry kinds: LLM wire traffic plus session-level lifecycle blocks. */
export const BuilderTraceKindSchema = z.enum([
  "llm_request",
  "llm_response",
  "llm_error",
  "session",
  "swap",
  "notice",
]);
export type BuilderTraceKind = z.infer<typeof BuilderTraceKindSchema>;

/**
 * One observability entry of a builder session. `data` holds the kind-specific
 * payload (LlmWireRequest / LlmWireResponse / LlmWireError / free-form session
 * facts); producers must keep entries self-describing via `title`.
 */
export const BuilderTraceEntrySchema = z.object({
  id: z.string(),
  /** Monotonic per-session sequence number (ordering key; ts is not monotonic). */
  seq: z.number().int().min(0),
  ts: z.number().int(),
  turn: z.number().int().min(0).default(0),
  kind: BuilderTraceKindSchema,
  title: z.string().default(""),
  data: z.record(z.string(), z.unknown()).default({}),
  durationMs: z.number().int().nullable().default(null),
});
export type BuilderTraceEntry = z.infer<typeof BuilderTraceEntrySchema>;

/**
 * One persisted observability record of a builder session: turn boundaries,
 * raw arena events, and trace entries (LLM wire traffic, hot-swaps, lifecycle).
 * Appended to the session's journal as produced and served back in the detail
 * view, so the execution trail survives restarts and accumulates across turns.
 */
export const BuilderTraceRecordSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("trace"), entry: BuilderTraceEntrySchema }),
  z.object({ kind: z.literal("event"), turn: z.number().int().min(1), event: ArenaEventSchema }),
  z.object({ kind: z.literal("turn"), turn: z.number().int().min(1), ts: z.number().int(), user: z.string() }),
]);
export type BuilderTraceRecord = z.infer<typeof BuilderTraceRecordSchema>;

/** Summary of one finished builder turn (assistant answer + final metrics). */
export const BuilderTurnMetaSchema = z.object({
  turn: z.number().int().min(1),
  runId: z.string().default(""),
  answer: z.string().default(""),
  metrics: PipelineMetricsSchema.nullable().default(null),
  workspace: z.string().default(""),
});
export type BuilderTurnMeta = z.infer<typeof BuilderTurnMetaSchema>;

/**
 * One SSE chunk of the builder chat stream. Trace entries and semantic arena
 * events travel on separate channels so the wire-level observability never
 * conflates with agent business events.
 */
export const BuilderStreamChunkSchema = z.discriminatedUnion("stream", [
  z.object({ stream: z.literal("trace"), entry: BuilderTraceEntrySchema }),
  z.object({ stream: z.literal("event"), event: ArenaEventSchema }),
  z.object({ stream: z.literal("turn"), turn: BuilderTurnMetaSchema }),
  z.object({ stream: z.literal("error"), message: z.string(), fatal: z.boolean().default(false) }),
]);
export type BuilderStreamChunk = z.infer<typeof BuilderStreamChunkSchema>;

// ---- block catalog ----

const BuilderFrameworkBlockSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["available", "reserved"]),
  reason: z.string().default(""),
});

const BuilderEndpointBlockSchema = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string().default(""),
  api_format: z.string().default(""),
  thinking_capable: z.boolean().default(false),
});
export type BuilderEndpointBlock = z.infer<typeof BuilderEndpointBlockSchema>;

const BuilderToolBlockSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  mutates_workspace: z.boolean().default(false),
});
export type BuilderToolBlock = z.infer<typeof BuilderToolBlockSchema>;

/** Capability block group id (one swappable slot each). */
export const BuilderCapabilityBlockIdSchema = z.enum([
  "reasoning",
  "context",
  "harness",
  "prompt_profile",
  "thinking",
  "mcp_policy",
  "skill_policy",
  "orchestration",
  "memory",
]);
export type BuilderCapabilityBlockId = z.infer<typeof BuilderCapabilityBlockIdSchema>;

const BuilderCapabilityOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().default(""),
});

const BuilderCapabilityGroupSchema = z.object({
  block: BuilderCapabilityBlockIdSchema,
  options: z.array(BuilderCapabilityOptionSchema),
});

/** The full block palette the builder UI renders. */
export const BuilderCatalogSchema = z.object({
  frameworks: z.array(BuilderFrameworkBlockSchema),
  endpoints: z.array(BuilderEndpointBlockSchema),
  tools: z.array(BuilderToolBlockSchema),
  capabilities: z.array(BuilderCapabilityGroupSchema),
});
export type BuilderCatalog = z.infer<typeof BuilderCatalogSchema>;

// ---- session views & requests ----

/** Client-facing session state (trace entries are served separately in the detail view). */
export const BuilderSessionViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
  composition: BuilderCompositionSchema,
  history: z.array(BuilderChatMessageSchema),
  running: z.boolean(),
  turn_count: z.number().int().min(0).default(0),
  workspace: z.string().default(""),
});
export type BuilderSessionView = z.infer<typeof BuilderSessionViewSchema>;

/**
 * Session detail: the view plus the session's persisted observability journal
 * (trace entries, arena events, turn markers — the full execution trail).
 */
export const BuilderSessionDetailSchema = z.object({
  session: BuilderSessionViewSchema,
  records: z.array(BuilderTraceRecordSchema),
});
export type BuilderSessionDetail = z.infer<typeof BuilderSessionDetailSchema>;

/** Creates a session. An empty name is legal: the store generates a display name. */
export const BuilderCreateRequestSchema = z.object({
  name: z.string().max(60).default(""),
  composition: BuilderCompositionSchema.partial().default({}),
});
export type BuilderCreateRequest = z.infer<typeof BuilderCreateRequestSchema>;

/** Hot-swaps composition blocks between turns and/or renames the session. */
export const BuilderPatchRequestSchema = z.object({
  composition: BuilderCompositionSchema.partial().optional(),
  name: z.string().max(60).optional(),
});
export type BuilderPatchRequest = z.infer<typeof BuilderPatchRequestSchema>;

/** Result of one hot-swap: field-level diff plus the notice queued for the next turn. */
export const BuilderSwapResultSchema = z.object({
  changed_fields: z.array(z.string()),
  tools_added: z.array(z.string()),
  tools_removed: z.array(z.string()),
  composition: BuilderCompositionSchema,
});
export type BuilderSwapResult = z.infer<typeof BuilderSwapResultSchema>;

/** Sends one chat message (starts a turn). */
export const BuilderChatRequestSchema = z.object({
  message: z.string().min(1).max(BUILDER_MESSAGE_MAX_CHARS),
  /** Files seeded into newly created session workspaces before the turn starts (arena parity). */
  attachments: z.array(RunAttachmentSchema).max(5).optional(),
});
export type BuilderChatRequest = z.infer<typeof BuilderChatRequestSchema>;

/** Answers one pending ask_user question of the session's in-flight turn. */
export const BuilderAnswerRequestSchema = z.object({
  /** Model-provided question id echoed from the ask_user action args. */
  question_id: z.string().min(1).max(64),
  /** The human's answer; an empty string means "skip, proceed without me". */
  answer: z.string().max(4_000).default(""),
});
export type BuilderAnswerRequest = z.infer<typeof BuilderAnswerRequestSchema>;
