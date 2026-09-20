/**
 * @file settings
 * @description Runtime configuration from env vars plus the repo-root .env.
 *
 * Responsibilities:
 * - Merge sources with env vars taking priority over .env
 * - Parse strictly and fail fast on range violations
 * - Build the CORS origin list and the LLM env seed for driver bootstrap
 */

import type { ApiFormat } from "@agentprism/contracts";
import { DEFAULT_LLM_BASE_URL, DEFAULT_MODEL_ID, DEFAULT_PROVIDER_NAME, THREAD_MESSAGE_MAX_CHARS } from "@agentprism/contracts";
import { loadEnvFile } from "./env-file.js";
import { ENV_FILE } from "./paths.js";

/** Service-process runtime config (env vars + repo-root .env; env vars take priority). */
export interface Settings {
  llmProviderName: string;
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  llmApiFormat: ApiFormat;
  llmTemperature: number;
  backendHost: string;
  frontendPort: number;
  backendPort: number;
  corsOrigins: string;
  maxRequestSize: number;
  apiToken: string;
  maxConcurrentRuns: number;
  llmTimeoutMs: number;
  llmMaxRetries: number;
  llmRetryDelayMs: number;
  breakerThreshold: number;
  breakerCooldownMs: number;
  askUserWaitMs: number;
  maxConcurrentColumns: number;
  maxWorkspaces: number;
  workspaceTtlSeconds: number;
  maxThreads: number;
  threadMaxHistoryMessages: number;
  threadMaxHistoryChars: number;
  contextWindowMessages: number;
  contextCharsPerToken: number;
  contextSummaryMaxChars: number;
  contextTokenBudgetChars: number;
  contextTokenBudgetKeepTurns: number;
  contextToolTailBudgetChars: number;
  contextToolTailKeepChars: number;
  contextBudgetTokens: number;
  contextCheckpointTargetTokens: number;
  toolMaxOutputChars: number;
  toolMaxFileChars: number;
  toolRunTimeoutDefaultS: number;
  toolRunTimeoutMaxS: number;
  webFetchTimeoutMs: number;
  webSearchTimeoutMs: number;
  mcpRequestTimeoutMs: number;
  mcpFetchTimeoutMs: number;
  toolSubagentMaxSteps: number;
  toolRalphMaxRounds: number;
  agentMaxDelegationDepth: number;
  fileFlushDebounceMs: number;
  workspaceLruWindowSeconds: number;
  sseHeartbeatMs: number;
  arenaEventRetention: number;
  arenaDisconnectGraceMs: number;
  threadAnswerTailChars: number;
  serverShutdownGraceMs: number;
  projectMaxCount: number;
  projectSnapshotMaxChars: number;
}

class SettingsLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsLoadError";
  }
}

function readString(source: Record<string, string>, key: string, fallback: string): string {
  const value = source[key];
  return value === undefined ? fallback : value;
}

/** Full-string integer match: rejects parseInt's prefix truncation ("123abc"→123, "0x10"→0). */
const INT_PATTERN = /^-?\d+$/;
/** Full-string decimal match: rejects parseFloat accepting "Infinity"/"1e5"/prefix truncation. */
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/** Shared strict reader: full-string pattern match, then range check (no prefix truncation, no Infinity). */
function readNumber(
  source: Record<string, string>,
  key: string,
  fallback: number,
  options: { pattern: RegExp; parse: (raw: string) => number; noun: string; range?: { min: number; max?: number } },
): number {
  const raw = source[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!options.pattern.test(raw.trim())) {
    throw new SettingsLoadError(`${key} must be ${options.noun}`);
  }
  const parsed = options.parse(raw);
  // Overly long numeric strings can parse to Infinity (e.g. 400 digits); reject explicitly
  if (!Number.isFinite(parsed)) {
    throw new SettingsLoadError(`${key} is outside the representable numeric range`);
  }
  const range = options.range;
  if (range !== undefined && (parsed < range.min || (range.max !== undefined && parsed > range.max))) {
    const bound = range.max === undefined ? `≥ ${range.min}` : `${range.min}-${range.max}`;
    throw new SettingsLoadError(`${key} must be ${bound}`);
  }
  return parsed;
}

function readInt(
  source: Record<string, string>,
  key: string,
  fallback: number,
  range?: { min: number; max?: number },
): number {
  // parseInt on a pattern-validated integer string always yields an integer; no truncation needed.
  return readNumber(source, key, fallback, {
    pattern: INT_PATTERN,
    parse: (raw) => Number.parseInt(raw, 10),
    noun: "an integer",
    range,
  });
}

function readFloat(
  source: Record<string, string>,
  key: string,
  fallback: number,
  range?: { min: number; max?: number },
): number {
  return readNumber(source, key, fallback, {
    pattern: DECIMAL_PATTERN,
    parse: (raw) => Number.parseFloat(raw),
    noun: "a number",
    range,
  });
}

function readApiFormat(source: Record<string, string>, key: string, fallback: ApiFormat): ApiFormat {
  const raw = source[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim();
  if (value !== "anthropic_messages" && value !== "openai_chat") {
    throw new SettingsLoadError(`${key} must be anthropic_messages or openai_chat`);
  }
  return value;
}

/**
 * CORS allowlist: both frontend-port hosts plus extra entries, deduplicated in order;
 * the wildcard * conflicts with allow_credentials=true and is rejected at load.
 */
export function buildCorsOriginList(corsOrigins: string, frontendPort: number): string[] {
  const origins: string[] = [
    `http://localhost:${frontendPort}`,
    `http://127.0.0.1:${frontendPort}`,
  ];
  for (const segment of corsOrigins.split(",")) {
    const trimmed = segment.trim();
    if (trimmed === "") continue;
    if (trimmed === "*") {
      throw new SettingsLoadError("CORS_ORIGINS must not use wildcard * (conflicts with allow_credentials)");
    }
    if (!origins.includes(trimmed)) origins.push(trimmed);
  }
  return origins;
}

/** Loads configuration from process env and the .env file. */
export function loadSettings(env: NodeJS.ProcessEnv = process.env, envFile: string = ENV_FILE): Settings {
  const fileValues = loadEnvFile(envFile);
  const source: Record<string, string> = { ...fileValues };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) source[key] = value;
  }

  const settings: Settings = {
    llmProviderName: readString(source, "LLM_PROVIDER_NAME", DEFAULT_PROVIDER_NAME),
    llmApiKey: readString(source, "LLM_API_KEY", ""),
    llmBaseUrl: readString(source, "LLM_BASE_URL", DEFAULT_LLM_BASE_URL),
    llmModel: readString(source, "LLM_MODEL", DEFAULT_MODEL_ID),
    llmApiFormat: readApiFormat(source, "LLM_API_FORMAT", "anthropic_messages"),
    llmTemperature: readFloat(source, "LLM_TEMPERATURE", 0.0, { min: 0, max: 2 }),
    backendHost: readString(source, "BACKEND_HOST", "127.0.0.1"),
    frontendPort: readInt(source, "FRONTEND_PORT", 8280, { min: 1, max: 65535 }),
    backendPort: readInt(source, "BACKEND_PORT", 8281, { min: 1, max: 65535 }),
    corsOrigins: readString(source, "CORS_ORIGINS", ""),
    maxRequestSize: readInt(source, "MAX_REQUEST_SIZE", 10 * 1024 * 1024, { min: 1024, max: 1024 * 1024 * 1024 }),
    apiToken: readString(source, "API_TOKEN", ""),
    maxConcurrentRuns: readInt(source, "MAX_CONCURRENT_RUNS", 4, { min: 1, max: 64 }),
    llmTimeoutMs: readInt(source, "LLM_TIMEOUT_MS", 120_000, { min: 1_000, max: 600_000 }),
    llmMaxRetries: readInt(source, "LLM_MAX_RETRIES", 2, { min: 0, max: 5 }),
    llmRetryDelayMs: readInt(source, "LLM_RETRY_DELAY_MS", 500, { min: 0, max: 10_000 }),
    breakerThreshold: readInt(source, "BREAKER_THRESHOLD", 3, { min: 1, max: 10 }),
    breakerCooldownMs: readInt(source, "BREAKER_COOLDOWN_MS", 30_000, { min: 1_000, max: 300_000 }),
    askUserWaitMs: readInt(source, "ASK_USER_WAIT_MS", 300_000, { min: 10_000, max: 600_000 }),
    maxConcurrentColumns: readInt(source, "MAX_CONCURRENT_COLUMNS", 8, { min: 1, max: 16 }),
    maxWorkspaces: readInt(source, "MAX_WORKSPACES", 32, { min: 1, max: 256 }),
    workspaceTtlSeconds: readInt(source, "WORKSPACE_TTL_SECONDS", 3600, { min: 60, max: 86_400 }),
    maxThreads: readInt(source, "MAX_THREADS", 24, { min: 1, max: 256 }),
    threadMaxHistoryMessages: readInt(source, "THREAD_MAX_HISTORY_MESSAGES", 60, { min: 2, max: 1_000 }),
    // Floor = 2 × the per-message clamp: one full-sized user+assistant pair must
    // always survive trimToCaps, or the just-committed turn would be trimmed away.
    threadMaxHistoryChars: readInt(source, "THREAD_MAX_HISTORY_CHARS", 96_000, {
      min: 2 * THREAD_MESSAGE_MAX_CHARS,
      max: 2_000_000,
    }),
    // Context strategy budgets (see packages/harness context/tuning.ts). Defaults
    // are English-calibrated: CJK-heavy content wants a lower CHARS_PER_TOKEN.
    contextWindowMessages: readInt(source, "CONTEXT_WINDOW_MESSAGES", 12, { min: 1, max: 200 }),
    contextCharsPerToken: readInt(source, "CONTEXT_CHARS_PER_TOKEN", 4, { min: 1, max: 16 }),
    contextSummaryMaxChars: readInt(source, "CONTEXT_SUMMARY_MAX_CHARS", 4_000, { min: 500, max: 100_000 }),
    contextTokenBudgetChars: readInt(source, "CONTEXT_TOKEN_BUDGET_CHARS", 24_000, { min: 1_000, max: 1_000_000 }),
    contextTokenBudgetKeepTurns: readInt(source, "CONTEXT_TOKEN_BUDGET_KEEP_TURNS", 6, { min: 0, max: 100 }),
    contextToolTailBudgetChars: readInt(source, "CONTEXT_TOOL_TAIL_BUDGET_CHARS", 4_000, { min: 500, max: 100_000 }),
    contextToolTailKeepChars: readInt(source, "CONTEXT_TOOL_TAIL_KEEP_CHARS", 1_200, { min: 100, max: 50_000 }),
    contextBudgetTokens: readInt(source, "CONTEXT_BUDGET_TOKENS", 6_000, { min: 500, max: 200_000 }),
    contextCheckpointTargetTokens: readInt(source, "CONTEXT_CHECKPOINT_TARGET_TOKENS", 2_000, { min: 200, max: 100_000 }),
    // Builtin tool caps and timeouts.
    toolMaxOutputChars: readInt(source, "TOOL_OUTPUT_MAX_CHARS", 32 * 1024, { min: 4_096, max: 1_048_576 }),
    toolMaxFileChars: readInt(source, "TOOL_FILE_MAX_CHARS", 256 * 1024, { min: 4_096, max: 4_194_304 }),
    toolRunTimeoutDefaultS: readInt(source, "TOOL_RUN_TIMEOUT_DEFAULT_S", 30, { min: 1, max: 600 }),
    toolRunTimeoutMaxS: readInt(source, "TOOL_RUN_TIMEOUT_MAX_S", 120, { min: 1, max: 3_600 }),
    webFetchTimeoutMs: readInt(source, "WEB_FETCH_TIMEOUT_MS", 15_000, { min: 1_000, max: 300_000 }),
    webSearchTimeoutMs: readInt(source, "WEB_SEARCH_TIMEOUT_MS", 15_000, { min: 1_000, max: 300_000 }),
    mcpRequestTimeoutMs: readInt(source, "MCP_REQUEST_TIMEOUT_MS", 30_000, { min: 1_000, max: 600_000 }),
    mcpFetchTimeoutMs: readInt(source, "MCP_FETCH_TIMEOUT_MS", 15_000, { min: 1_000, max: 300_000 }),
    toolSubagentMaxSteps: readInt(source, "TOOL_SUBAGENT_MAX_STEPS", 10, { min: 1, max: 40 }),
    toolRalphMaxRounds: readInt(source, "TOOL_RALPH_MAX_ROUNDS", 8, { min: 1, max: 64 }),
    agentMaxDelegationDepth: readInt(source, "AGENT_MAX_DELEGATION_DEPTH", 1, { min: 1, max: 3 }),
    // Store/workspace/stream lifecycle.
    fileFlushDebounceMs: readInt(source, "FILE_FLUSH_DEBOUNCE_MS", 300, { min: 50, max: 10_000 }),
    workspaceLruWindowSeconds: readInt(source, "WORKSPACE_LRU_WINDOW_SECONDS", 300, { min: 30, max: 86_400 }),
    sseHeartbeatMs: readInt(source, "SSE_HEARTBEAT_MS", 15_000, { min: 1_000, max: 60_000 }),
    // Run/service/server caps.
    arenaEventRetention: readInt(source, "ARENA_EVENT_RETENTION", 5_000, { min: 500, max: 100_000 }),
    arenaDisconnectGraceMs: readInt(source, "ARENA_DISCONNECT_GRACE_MS", 5_000, { min: 500, max: 60_000 }),
    threadAnswerTailChars: readInt(source, "THREAD_ANSWER_TAIL_CHARS", 2_000, { min: 200, max: 100_000 }),
    serverShutdownGraceMs: readInt(source, "SERVER_SHUTDOWN_GRACE_MS", 5_000, { min: 500, max: 60_000 }),
    projectMaxCount: readInt(source, "PROJECT_MAX_COUNT", 50, { min: 1, max: 1_000 }),
    projectSnapshotMaxChars: readInt(source, "PROJECT_SNAPSHOT_MAX_CHARS", 2_000_000, { min: 100_000, max: 20_000_000 }),
  };

  // Fail fast on validation: a wildcard config fails immediately
  buildCorsOriginList(settings.corsOrigins, settings.frontendPort);
  // Thread workspaces are pinned against eviction, so the registry must always
  // fit every thread pin plus at least one slot for arena runs; a registry full
  // of pins makes the next workspace creation fail loudly mid-run.
  if (settings.toolRunTimeoutMaxS < settings.toolRunTimeoutDefaultS) {
    throw new SettingsLoadError(
      `TOOL_RUN_TIMEOUT_MAX_S (${settings.toolRunTimeoutMaxS}) must not be below TOOL_RUN_TIMEOUT_DEFAULT_S (${settings.toolRunTimeoutDefaultS})`,
    );
  }
  if (settings.maxWorkspaces <= settings.maxThreads) {
    throw new SettingsLoadError(
      `MAX_WORKSPACES (${settings.maxWorkspaces}) must exceed MAX_THREADS (${settings.maxThreads}): every thread can pin one workspace, and a full registry of pins leaves arena runs no slot`,
    );
  }
  return settings;
}

/** LLM env summary used to seed the fallback when provider config is missing. */
export interface LlmEnvSeed {
  providerName: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  apiFormat: ApiFormat;
  temperature: number;
}

/** Projects service settings onto the provider seed (naming bridge only, no defaults here). */
export function toLlmEnvSeed(settings: Settings): LlmEnvSeed {
  return {
    providerName: settings.llmProviderName,
    apiKey: settings.llmApiKey,
    baseUrl: settings.llmBaseUrl,
    model: settings.llmModel,
    apiFormat: settings.llmApiFormat,
    temperature: settings.llmTemperature,
  };
}
