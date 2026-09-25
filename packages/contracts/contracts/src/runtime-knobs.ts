/**
 * @file runtime-knobs
 * @description Operator-tunable runtime knob types and field metadata (single source).
 *
 * Responsibilities:
 * - Define the RuntimeKnobs shape (context budgets, reasoning widths, harness retries)
 * - Provide the settings-UI field metadata (group/kind/range/options/defaults)
 *
 * Defaults must stay in sync with the driver-side fallbacks (driver-run-support
 * reasoning-constants) and the harness strategy fallbacks; env-derived defaults
 * live in config (defaultRuntimeKnobs over the Settings reads).
 */

/** Retry caps per harness level (overrides HARNESS_MAX_RETRIES when present). */
export interface HarnessRetriesKnobs {
  verify: number;
  reflect: number;
  selfEvolve: number;
}

/** Operator-tunable runtime values applied live (no restart). */
export interface RuntimeKnobs {
  contextWindowMessages: number;
  contextCharsPerToken: number;
  contextSummaryMaxChars: number;
  contextTokenBudgetChars: number;
  contextTokenBudgetKeepTurns: number;
  contextToolTailBudgetChars: number;
  contextToolTailKeepChars: number;
  contextBudgetTokens: number;
  contextCheckpointTargetTokens: number;
  selfConsistencyN: number;
  totWidth: number;
  crewaiProcess: "sequential" | "hierarchical";
  harnessRetries: HarnessRetriesKnobs;
  subagentMaxSteps: number;
  ralphMaxRounds: number;
  mcpFetchTimeoutMs: number;
  agentMaxDelegationDepth: number;
  llmTimeoutMs: number;
  llmMaxRetries: number;
}

/** One settings-UI field: kind, range/options, and default (labels live in web i18n). */
export interface RuntimeKnobFieldMeta {
  key: string;
  group: "context" | "reasoning" | "harness" | "tools" | "llm";
  kind: "number" | "select";
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
  default: number | string;
}

const HARNESS_RETRIES_DEFAULT = 2;
const HARNESS_RETRIES_MIN = 1;
const HARNESS_RETRIES_MAX = 5;

/** Numeric field metadata (flattened keys; harnessRetries uses dotted paths). */
export const RUNTIME_KNOB_FIELDS: readonly RuntimeKnobFieldMeta[] = [
  { key: "contextWindowMessages", group: "context", kind: "number", min: 1, max: 200, step: 1, default: 12 },
  { key: "contextCharsPerToken", group: "context", kind: "number", min: 1, max: 16, step: 1, default: 4 },
  { key: "contextSummaryMaxChars", group: "context", kind: "number", min: 500, max: 100_000, step: 100, default: 4000 },
  { key: "contextTokenBudgetChars", group: "context", kind: "number", min: 1000, max: 1_000_000, step: 500, default: 24_000 },
  { key: "contextTokenBudgetKeepTurns", group: "context", kind: "number", min: 0, max: 100, step: 1, default: 6 },
  { key: "contextToolTailBudgetChars", group: "context", kind: "number", min: 500, max: 100_000, step: 100, default: 4000 },
  { key: "contextToolTailKeepChars", group: "context", kind: "number", min: 100, max: 50_000, step: 50, default: 1200 },
  { key: "contextBudgetTokens", group: "context", kind: "number", min: 500, max: 200_000, step: 100, default: 6000 },
  { key: "contextCheckpointTargetTokens", group: "context", kind: "number", min: 200, max: 100_000, step: 100, default: 2000 },
  { key: "selfConsistencyN", group: "reasoning", kind: "number", min: 2, max: 9, step: 1, default: 5 },
  { key: "totWidth", group: "reasoning", kind: "number", min: 2, max: 5, step: 1, default: 3 },
  { key: "crewaiProcess", group: "reasoning", kind: "select", options: ["sequential", "hierarchical"], default: "sequential" },
  { key: "harnessRetries.verify", group: "harness", kind: "number", min: HARNESS_RETRIES_MIN, max: HARNESS_RETRIES_MAX, step: 1, default: HARNESS_RETRIES_DEFAULT },
  { key: "harnessRetries.reflect", group: "harness", kind: "number", min: HARNESS_RETRIES_MIN, max: HARNESS_RETRIES_MAX, step: 1, default: HARNESS_RETRIES_DEFAULT },
  { key: "harnessRetries.selfEvolve", group: "harness", kind: "number", min: HARNESS_RETRIES_MIN, max: HARNESS_RETRIES_MAX, step: 1, default: HARNESS_RETRIES_DEFAULT },
  { key: "subagentMaxSteps", group: "tools", kind: "number", min: 1, max: 100, step: 1, default: 20 },
  { key: "ralphMaxRounds", group: "tools", kind: "number", min: 1, max: 16, step: 1, default: 3 },
  { key: "mcpFetchTimeoutMs", group: "tools", kind: "number", min: 5_000, max: 300_000, step: 5_000, default: 30_000 },
  { key: "agentMaxDelegationDepth", group: "tools", kind: "number", min: 0, max: 3, step: 1, default: 1 },
  { key: "llmTimeoutMs", group: "llm", kind: "number", min: 10_000, max: 600_000, step: 10_000, default: 120_000 },
  { key: "llmMaxRetries", group: "llm", kind: "number", min: 0, max: 5, step: 1, default: 2 },
];

/** The static default knob set (env-derived defaults layer on top in config). */
export function staticDefaultRuntimeKnobs(): RuntimeKnobs {
  return {
    contextWindowMessages: 12,
    contextCharsPerToken: 4,
    contextSummaryMaxChars: 4000,
    contextTokenBudgetChars: 24_000,
    contextTokenBudgetKeepTurns: 6,
    contextToolTailBudgetChars: 4000,
    contextToolTailKeepChars: 1200,
    contextBudgetTokens: 6000,
    contextCheckpointTargetTokens: 2000,
    selfConsistencyN: 5,
    totWidth: 3,
    crewaiProcess: "sequential",
    harnessRetries: {
      verify: HARNESS_RETRIES_DEFAULT,
      reflect: HARNESS_RETRIES_DEFAULT,
      selfEvolve: HARNESS_RETRIES_DEFAULT,
    },
    subagentMaxSteps: 20,
    ralphMaxRounds: 3,
    mcpFetchTimeoutMs: 30_000,
    agentMaxDelegationDepth: 1,
    llmTimeoutMs: 120_000,
    llmMaxRetries: 2,
  };
}
