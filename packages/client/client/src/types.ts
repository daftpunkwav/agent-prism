/**
 * @file types
 * @description Client-side contract views mirrored from server Zod schemas.
 *
 * Responsibilities:
 * - Re-export @agentprism/contracts types so client and server stay in sync
 * - Declare the two frontend-local shapes (ProjectCreate, report payload alias)
 */

import type { RuntimeKnobFieldMeta, RuntimeKnobs } from "@agentprism/contracts";

export type {
  ArenaEvent,
  ArenaMeta,
  RuntimeKnobFieldMeta,
  RuntimeKnobs,
  AskUserQuestion,
  BaselineField,
  BaselineFieldOption,
  BaselineOverrides,
  ChatMessage,
  ColumnSession,
  DimensionId,
  DimensionMeta,
  DimensionOption,
  JudgeResult,
  JudgeSpec,
  LlmEndpointPublic,
  PipelineMetrics,
  PipelineRunResult,
  Project,
  RunAttachment,
  SessionEntry,
  SessionKind,
  SessionRecord,
  SessionStatus,
  TaskTemplate,
  ThinkingLevel,
  ThreadCreateRequest,
  ThreadDetail,
  ThreadForkRequest,
  ThreadRunRequest,
  ThreadView,
  TokenStats,
  WorkspaceFileContent,
  WorkspaceFileEntry,
  WorkspaceFileUpsert,
} from "@agentprism/contracts";

export type { ComparisonReport as ComparisonReportPayload } from "@agentprism/contracts";
// Run-log read view + envelope: contract single source (contracts/run-logs), consumed by the frontend through this outlet.
export type { ColumnLogs, LlmWireRecord, WireLogEntry } from "@agentprism/contracts";

/** Builder contracts: block composition, sessions, trace entries, stream chunks. */
export type {
  BuilderCapabilityBlockId,
  BuilderCatalog,
  BuilderChatMessage,
  BuilderComposition,
  BuilderCompositionInput,
  BuilderCompositionPatch,
  BuilderCreateRequest,
  BuilderEndpointBlock,
  BuilderPatchRequest,
  BuilderSessionDetail,
  BuilderSessionView,
  BuilderStreamChunk,
  BuilderSwapResult,
  BuilderToolBlock,
  BuilderTraceEntry,
  BuilderTraceKind,
  BuilderTraceRecord,
  BuilderTurnMeta,
  LlmWireMessage,
  LlmWireRequest,
  LlmWireResponse,
  LlmWireToolCall,
} from "@agentprism/contracts";
export type { ProviderConfigPublic as ProviderConfig } from "@agentprism/contracts";

/** Provider update payloads and connection-test results: contract single source (contracts/provider), consumed by the frontend through this outlet. */
export type {
  ConnectionTestResult,
  LlmEndpointUpdate,
  LlmEndpointUpdateInput,
  ProviderConfigUpdate,
  ProviderConfigUpdateInput,
} from "@agentprism/contracts";

/** Dimension mapping constants: contract single source (contracts/dimension-field), consumed by the frontend through this outlet. */
export { DIMENSION_FIELD, DIMENSION_IDS } from "@agentprism/contracts";

/** Unified clamp ranges for decode-default editing controls: contract single source (contracts/decode-options), shared by both editors. */
export { DECODE_FIELD_RANGES } from "@agentprism/contracts";

/** Session character budget and the tool registry: contract single source, consumed by frontend trimming and Trace classification. */
export { MAX_HISTORY_CHARS, TOOL_NAMES_BY_TOOLSET } from "@agentprism/contracts";

/** Brand constants such as the default provider name: contract single source (contracts/provider), consumed by frontend placeholder copy — hardcoding is forbidden. */
export { DEFAULT_PROVIDER_NAME, DEFAULT_MODEL_ID } from "@agentprism/contracts";

export interface ProjectCreate {
  name: string;
  question: string;
  dimension: string;
  pipeline_labels: string[];
  workspace_names?: string[];
}

/** Runtime knobs GET/PUT payload: current values plus UI field metadata. */
export interface RuntimeKnobsPayload {
  knobs: RuntimeKnobs;
  fields: RuntimeKnobFieldMeta[];
}

/** Memory store status: entry counts and persistence paths. */
export interface MemoryStatus {
  episodicCount: number;
  semanticCount: number;
  episodicPath: string;
  semanticPath: string;
}
