/**
 * @file settings tests
 * @description Covers loadSettings parsing and validation.
 *
 * Responsibilities:
 * - Merge env sources and enforce range checks with fail-fast errors
 */

import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSettings } from "@agentprism/config";

/** Point at a .env that cannot exist: isolate host .env and process env from assertions. */
const MISSING_ENV = join(tmpdir(), `aprism-missing-${randomUUID()}.env`);

describe("loadSettings parsing and range checks", () => {
  it("integers are not prefix-truncated: junk suffixes and radix literals are rejected", () => {
    expect(() => loadSettings({ BACKEND_PORT: "123abc" }, MISSING_ENV)).toThrow(/BACKEND_PORT/);
    expect(() => loadSettings({ BACKEND_PORT: "0x10" }, MISSING_ENV)).toThrow(/BACKEND_PORT/);
    expect(loadSettings({ BACKEND_PORT: "8281 " }, MISSING_ENV).backendPort).toBe(8281);
  });

  it("out-of-range ports fail fast", () => {
    expect(() => loadSettings({ BACKEND_PORT: "0" }, MISSING_ENV)).toThrow(/1-65535/);
    expect(() => loadSettings({ FRONTEND_PORT: "70000" }, MISSING_ENV)).toThrow(/1-65535/);
  });

  it("request body limit and concurrency sign checks", () => {
    expect(() => loadSettings({ MAX_REQUEST_SIZE: "-1" }, MISSING_ENV)).toThrow(/MAX_REQUEST_SIZE/);
    expect(() => loadSettings({ MAX_CONCURRENT_RUNS: "0" }, MISSING_ENV)).toThrow(/MAX_CONCURRENT_RUNS/);
  });

  it("floats parse strictly: rejects Infinity / scientific / suffixes", () => {
    expect(() => loadSettings({ LLM_TEMPERATURE: "Infinity" }, MISSING_ENV)).toThrow(/LLM_TEMPERATURE/);
    expect(() => loadSettings({ LLM_TEMPERATURE: "0.7abc" }, MISSING_ENV)).toThrow(/LLM_TEMPERATURE/);
    expect(loadSettings({ LLM_TEMPERATURE: "0.7" }, MISSING_ENV).llmTemperature).toBe(0.7);
  });

  it("llm retry delay range checks", () => {
    expect(() => loadSettings({ LLM_RETRY_DELAY_MS: "-1" }, MISSING_ENV)).toThrow(/LLM_RETRY_DELAY_MS/);
    expect(() => loadSettings({ LLM_RETRY_DELAY_MS: "10001" }, MISSING_ENV)).toThrow(/LLM_RETRY_DELAY_MS/);
    expect(loadSettings({ LLM_RETRY_DELAY_MS: "0" }, MISSING_ENV).llmRetryDelayMs).toBe(0);
  });

  it("context strategy budgets parse and range-check", () => {
    const tuned = loadSettings(
      {
        CONTEXT_WINDOW_MESSAGES: "24",
        CONTEXT_CHARS_PER_TOKEN: "2",
        CONTEXT_SUMMARY_MAX_CHARS: "8000",
        CONTEXT_TOKEN_BUDGET_CHARS: "48000",
        CONTEXT_TOKEN_BUDGET_KEEP_TURNS: "10",
        CONTEXT_TOOL_TAIL_BUDGET_CHARS: "8000",
        CONTEXT_TOOL_TAIL_KEEP_CHARS: "2000",
        CONTEXT_BUDGET_TOKENS: "12000",
        CONTEXT_CHECKPOINT_TARGET_TOKENS: "4000",
      },
      MISSING_ENV,
    );
    expect(tuned.contextWindowMessages).toBe(24);
    expect(tuned.contextCharsPerToken).toBe(2);
    expect(tuned.contextSummaryMaxChars).toBe(8_000);
    expect(tuned.contextTokenBudgetChars).toBe(48_000);
    expect(tuned.contextTokenBudgetKeepTurns).toBe(10);
    expect(tuned.contextToolTailBudgetChars).toBe(8_000);
    expect(tuned.contextToolTailKeepChars).toBe(2_000);
    expect(tuned.contextBudgetTokens).toBe(12_000);
    expect(tuned.contextCheckpointTargetTokens).toBe(4_000);

    expect(() => loadSettings({ CONTEXT_WINDOW_MESSAGES: "0" }, MISSING_ENV)).toThrow(/CONTEXT_WINDOW_MESSAGES/);
    expect(() => loadSettings({ CONTEXT_CHARS_PER_TOKEN: "17" }, MISSING_ENV)).toThrow(/CONTEXT_CHARS_PER_TOKEN/);
    expect(() => loadSettings({ CONTEXT_SUMMARY_MAX_CHARS: "499" }, MISSING_ENV)).toThrow(/CONTEXT_SUMMARY_MAX_CHARS/);
    expect(() => loadSettings({ CONTEXT_TOKEN_BUDGET_CHARS: "999" }, MISSING_ENV)).toThrow(/CONTEXT_TOKEN_BUDGET_CHARS/);
    expect(() => loadSettings({ CONTEXT_TOKEN_BUDGET_KEEP_TURNS: "101" }, MISSING_ENV)).toThrow(/CONTEXT_TOKEN_BUDGET_KEEP_TURNS/);
    expect(() => loadSettings({ CONTEXT_TOOL_TAIL_BUDGET_CHARS: "499" }, MISSING_ENV)).toThrow(/CONTEXT_TOOL_TAIL_BUDGET_CHARS/);
    expect(() => loadSettings({ CONTEXT_TOOL_TAIL_KEEP_CHARS: "99" }, MISSING_ENV)).toThrow(/CONTEXT_TOOL_TAIL_KEEP_CHARS/);
    expect(() => loadSettings({ CONTEXT_BUDGET_TOKENS: "499" }, MISSING_ENV)).toThrow(/CONTEXT_BUDGET_TOKENS/);
    expect(() => loadSettings({ CONTEXT_CHECKPOINT_TARGET_TOKENS: "199" }, MISSING_ENV)).toThrow(/CONTEXT_CHECKPOINT_TARGET_TOKENS/);
  });

  it("overlong digit strings that parse to Infinity fail fast; unbounded fields still have caps", () => {
    // 400-digit string makes parseInt return Infinity; old code bypassed ≥min range checks
    expect(() => loadSettings({ MAX_REQUEST_SIZE: "9".repeat(400) }, MISSING_ENV)).toThrow(/MAX_REQUEST_SIZE/);
    expect(() => loadSettings({ BACKEND_PORT: "9".repeat(400) }, MISSING_ENV)).toThrow(/BACKEND_PORT/);
    expect(() => loadSettings({ MAX_REQUEST_SIZE: String(2 * 1024 * 1024 * 1024) }, MISSING_ENV)).toThrow(
      /MAX_REQUEST_SIZE/,
    );
    expect(() => loadSettings({ MAX_CONCURRENT_RUNS: "65" }, MISSING_ENV)).toThrow(/MAX_CONCURRENT_RUNS/);
    expect(() => loadSettings({ LLM_TEMPERATURE: "99" }, MISSING_ENV)).toThrow(/LLM_TEMPERATURE/);
    expect(loadSettings({ MAX_CONCURRENT_RUNS: "64" }, MISSING_ENV).maxConcurrentRuns).toBe(64);
  });

  it("valid config loads and defaults apply", () => {
    const settings = loadSettings({}, MISSING_ENV);
    expect(settings.backendPort).toBe(8281);
    expect(settings.frontendPort).toBe(8280);
    expect(settings.maxConcurrentRuns).toBe(4);
    expect(settings.maxRequestSize).toBe(10 * 1024 * 1024);
    expect(settings.maxConcurrentColumns).toBe(8);
    expect(settings.maxWorkspaces).toBe(32);
    expect(settings.workspaceTtlSeconds).toBe(3600);
    expect(settings.maxThreads).toBe(24);
    expect(settings.threadMaxHistoryMessages).toBe(60);
    expect(settings.threadMaxHistoryChars).toBe(96_000);
    expect(settings.llmRetryDelayMs).toBe(500);
    expect(settings.contextWindowMessages).toBe(12);
    expect(settings.contextCharsPerToken).toBe(4);
    expect(settings.contextSummaryMaxChars).toBe(4_000);
    expect(settings.contextTokenBudgetChars).toBe(24_000);
    expect(settings.contextTokenBudgetKeepTurns).toBe(6);
    expect(settings.contextToolTailBudgetChars).toBe(4_000);
    expect(settings.contextToolTailKeepChars).toBe(1_200);
    expect(settings.contextBudgetTokens).toBe(6_000);
    expect(settings.contextCheckpointTargetTokens).toBe(2_000);
  });

  it("column/workspace/concurrency bounds fail fast", () => {
    expect(() => loadSettings({ MAX_CONCURRENT_COLUMNS: "0" }, MISSING_ENV)).toThrow(/MAX_CONCURRENT_COLUMNS/);
    expect(() => loadSettings({ MAX_CONCURRENT_COLUMNS: "17" }, MISSING_ENV)).toThrow(/MAX_CONCURRENT_COLUMNS/);
    expect(() => loadSettings({ MAX_WORKSPACES: "0" }, MISSING_ENV)).toThrow(/MAX_WORKSPACES/);
    expect(() => loadSettings({ WORKSPACE_TTL_SECONDS: "59" }, MISSING_ENV)).toThrow(/WORKSPACE_TTL_SECONDS/);
    expect(loadSettings({ MAX_CONCURRENT_COLUMNS: "16" }, MISSING_ENV).maxConcurrentColumns).toBe(16);
  });

  it("thread caps parse, range-check, and honor the per-message clamp floor", () => {
    const tuned = loadSettings(
      { MAX_THREADS: "128", MAX_WORKSPACES: "160", THREAD_MAX_HISTORY_MESSAGES: "120", THREAD_MAX_HISTORY_CHARS: "192000" },
      MISSING_ENV,
    );
    expect(tuned.maxThreads).toBe(128);
    expect(tuned.threadMaxHistoryMessages).toBe(120);
    expect(tuned.threadMaxHistoryChars).toBe(192_000);

    expect(() => loadSettings({ MAX_THREADS: "0" }, MISSING_ENV)).toThrow(/MAX_THREADS/);
    expect(() => loadSettings({ MAX_THREADS: "257" }, MISSING_ENV)).toThrow(/MAX_THREADS/);
    expect(() => loadSettings({ THREAD_MAX_HISTORY_MESSAGES: "1" }, MISSING_ENV)).toThrow(/THREAD_MAX_HISTORY_MESSAGES/);
    expect(() => loadSettings({ THREAD_MAX_HISTORY_MESSAGES: "1001" }, MISSING_ENV)).toThrow(/THREAD_MAX_HISTORY_MESSAGES/);
    // One full-sized user+assistant pair (2 × 32 000) must survive the trim, so smaller floors are rejected.
    expect(() => loadSettings({ THREAD_MAX_HISTORY_CHARS: "63999" }, MISSING_ENV)).toThrow(/THREAD_MAX_HISTORY_CHARS/);
    expect(loadSettings({ THREAD_MAX_HISTORY_CHARS: "64000" }, MISSING_ENV).threadMaxHistoryChars).toBe(64_000);
  });

  it("tool caps and timeouts parse, range-check, and keep sane ordering", () => {
    const tuned = loadSettings(
      {
        TOOL_OUTPUT_MAX_CHARS: "65536",
        TOOL_FILE_MAX_CHARS: "131072",
        TOOL_RUN_TIMEOUT_DEFAULT_S: "45",
        TOOL_RUN_TIMEOUT_MAX_S: "300",
        WEB_FETCH_TIMEOUT_MS: "20000",
        WEB_SEARCH_TIMEOUT_MS: "20000",
        MCP_REQUEST_TIMEOUT_MS: "45000",
        MCP_FETCH_TIMEOUT_MS: "20000",
        TOOL_SUBAGENT_MAX_STEPS: "20",
        TOOL_RALPH_MAX_ROUNDS: "12",
        AGENT_MAX_DELEGATION_DEPTH: "2",
      },
      MISSING_ENV,
    );
    expect(tuned.toolMaxOutputChars).toBe(65_536);
    expect(tuned.toolMaxFileChars).toBe(131_072);
    expect(tuned.toolRunTimeoutDefaultS).toBe(45);
    expect(tuned.toolRunTimeoutMaxS).toBe(300);
    expect(tuned.webFetchTimeoutMs).toBe(20_000);
    expect(tuned.webSearchTimeoutMs).toBe(20_000);
    expect(tuned.mcpRequestTimeoutMs).toBe(45_000);
    expect(tuned.mcpFetchTimeoutMs).toBe(20_000);
    expect(tuned.toolSubagentMaxSteps).toBe(20);
    expect(tuned.toolRalphMaxRounds).toBe(12);
    expect(tuned.agentMaxDelegationDepth).toBe(2);

    expect(() => loadSettings({ TOOL_OUTPUT_MAX_CHARS: "4095" }, MISSING_ENV)).toThrow(/TOOL_OUTPUT_MAX_CHARS/);
    expect(() => loadSettings({ TOOL_RUN_TIMEOUT_DEFAULT_S: "0" }, MISSING_ENV)).toThrow(/TOOL_RUN_TIMEOUT_DEFAULT_S/);
    expect(() => loadSettings({ AGENT_MAX_DELEGATION_DEPTH: "4" }, MISSING_ENV)).toThrow(/AGENT_MAX_DELEGATION_DEPTH/);
    // The max clamp must stay above the default, or every run would time out.
    expect(() => loadSettings(
      { TOOL_RUN_TIMEOUT_DEFAULT_S: "60", TOOL_RUN_TIMEOUT_MAX_S: "30" },
      MISSING_ENV,
    )).toThrow(/TOOL_RUN_TIMEOUT_MAX_S/);
  });

  it("lifecycle knobs parse and range-check", () => {
    const tuned = loadSettings(
      { FILE_FLUSH_DEBOUNCE_MS: "500", WORKSPACE_LRU_WINDOW_SECONDS: "600", SSE_HEARTBEAT_MS: "5000" },
      MISSING_ENV,
    );
    expect(tuned.fileFlushDebounceMs).toBe(500);
    expect(tuned.workspaceLruWindowSeconds).toBe(600);
    expect(tuned.sseHeartbeatMs).toBe(5_000);

    expect(() => loadSettings({ FILE_FLUSH_DEBOUNCE_MS: "49" }, MISSING_ENV)).toThrow(/FILE_FLUSH_DEBOUNCE_MS/);
    expect(() => loadSettings({ WORKSPACE_LRU_WINDOW_SECONDS: "29" }, MISSING_ENV)).toThrow(/WORKSPACE_LRU_WINDOW_SECONDS/);
    expect(() => loadSettings({ SSE_HEARTBEAT_MS: "999" }, MISSING_ENV)).toThrow(/SSE_HEARTBEAT_MS/);
  });

  it("run and service caps parse and range-check", () => {
    const tuned = loadSettings(
      {
        ARENA_EVENT_RETENTION: "8000",
        ARENA_DISCONNECT_GRACE_MS: "8000",
        THREAD_ANSWER_TAIL_CHARS: "4000",
        SERVER_SHUTDOWN_GRACE_MS: "8000",
        PROJECT_MAX_COUNT: "100",
        PROJECT_SNAPSHOT_MAX_CHARS: "4000000",
      },
      MISSING_ENV,
    );
    expect(tuned.arenaEventRetention).toBe(8_000);
    expect(tuned.arenaDisconnectGraceMs).toBe(8_000);
    expect(tuned.threadAnswerTailChars).toBe(4_000);
    expect(tuned.serverShutdownGraceMs).toBe(8_000);
    expect(tuned.projectMaxCount).toBe(100);
    expect(tuned.projectSnapshotMaxChars).toBe(4_000_000);

    expect(() => loadSettings({ ARENA_EVENT_RETENTION: "499" }, MISSING_ENV)).toThrow(/ARENA_EVENT_RETENTION/);
    expect(() => loadSettings({ THREAD_ANSWER_TAIL_CHARS: "199" }, MISSING_ENV)).toThrow(/THREAD_ANSWER_TAIL_CHARS/);
    expect(() => loadSettings({ SERVER_SHUTDOWN_GRACE_MS: "499" }, MISSING_ENV)).toThrow(/SERVER_SHUTDOWN_GRACE_MS/);
    expect(() => loadSettings({ PROJECT_MAX_COUNT: "0" }, MISSING_ENV)).toThrow(/PROJECT_MAX_COUNT/);
    expect(() => loadSettings({ PROJECT_SNAPSHOT_MAX_CHARS: "99999" }, MISSING_ENV)).toThrow(/PROJECT_SNAPSHOT_MAX_CHARS/);
  });

  it("fails fast when the workspace registry cannot fit every thread pin plus an arena slot", () => {
    expect(() => loadSettings({ MAX_THREADS: "24", MAX_WORKSPACES: "24" }, MISSING_ENV)).toThrow(/MAX_WORKSPACES/);
    expect(() => loadSettings({ MAX_THREADS: "128", MAX_WORKSPACES: "32" }, MISSING_ENV)).toThrow(/MAX_WORKSPACES/);
    const valid = loadSettings({ MAX_THREADS: "128", MAX_WORKSPACES: "160" }, MISSING_ENV);
    expect(valid.maxThreads).toBe(128);
    expect(valid.maxWorkspaces).toBe(160);
  });
});

describe("loadSettings env-file compatibility", () => {
  it("accepts shell-style export prefixes in .env files", () => {
    const file = join(tmpdir(), `aprism-export-${randomUUID()}.env`);
    writeFileSync(file, "export BACKEND_PORT=9999\n# comment\nBACKEND_HOST=example.com\n", "utf8");
    try {
      const settings = loadSettings({}, file);
      expect(settings.backendPort).toBe(9999);
      expect(settings.backendHost).toBe("example.com");
    } finally {
      rmSync(file, { force: true });
    }
  });

  it("trims whitespace-padded api format like the numeric readers", () => {
    expect(loadSettings({ LLM_API_FORMAT: "  openai_chat  " }, MISSING_ENV).llmApiFormat).toBe("openai_chat");
    expect(loadSettings({ LLM_API_FORMAT: "openai_responses" }, MISSING_ENV).llmApiFormat).toBe("openai_responses");
    expect(() => loadSettings({ LLM_API_FORMAT: "openai" }, MISSING_ENV)).toThrow(/LLM_API_FORMAT/);
  });
});
