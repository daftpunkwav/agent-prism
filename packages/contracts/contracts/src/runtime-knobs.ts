/**
 * @file runtime-knobs
 * @description Operator-tunable runtime knob types and field metadata (single source).
 *
 * Responsibilities:
 * - Define the RuntimeKnobs shape (context budgets, reasoning widths, harness retries)
 * - Provide the settings-UI field metadata (group/kind/range/options/defaults)
 *
 * Reasoning-width defaults are exported here and reused by the driver-side
 * fallbacks (driver-run-support reasoning-constants), so knob reset and driver
 * fallback cannot drift. The remaining defaults must stay in sync with the
 * harness strategy fallbacks; env-derived defaults live in config
 * (defaultRuntimeKnobs over the Settings reads).
 */

import type { HarnessLevel } from "./enums.js";

/** Default ToT branching width: one source for the settings-UI default and the driver-side env fallback. */
export const TOT_WIDTH_DEFAULT = 3;

/** Default self-consistency attempt count (each attempt is a full react loop). */
export const SELF_CONSISTENCY_N_DEFAULT = 5;

/** Retry caps per harness level (overrides HARNESS_MAX_RETRIES when present). */
export interface HarnessRetriesKnobs {
  verify: number;
  reflect: number;
  selfEvolve: number;
}

/**
 * Maps the operator's harness retry knobs onto the run-level override bag keyed
 * by harness level token. The knob keeps the wire's camelCase `selfEvolve` while
 * runVerificationLoop reads `maxRetries[level]` (level token `self_evolve`), so a
 * hand-written camelCase key typechecks and is silently ignored at runtime — that
 * cap would never apply. This is the single mapping seam between the two shapes.
 */
export function harnessRetryCaps(knobs: HarnessRetriesKnobs): Partial<Record<HarnessLevel, number>> {
  return { verify: knobs.verify, reflect: knobs.reflect, self_evolve: knobs.selfEvolve };
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
  { key: "selfConsistencyN", group: "reasoning", kind: "number", min: 2, max: 9, step: 1, default: SELF_CONSISTENCY_N_DEFAULT },
  { key: "totWidth", group: "reasoning", kind: "number", min: 2, max: 5, step: 1, default: TOT_WIDTH_DEFAULT },
  { key: "crewaiProcess", group: "reasoning", kind: "select", options: ["sequential", "hierarchical"], default: "sequential" },
  { key: "harnessRetries.verify", group: "harness", kind: "number", min: HARNESS_RETRIES_MIN, max: HARNESS_RETRIES_MAX, step: 1, default: HARNESS_RETRIES_DEFAULT },
  { key: "harnessRetries.reflect", group: "harness", kind: "number", min: HARNESS_RETRIES_MIN, max: HARNESS_RETRIES_MAX, step: 1, default: HARNESS_RETRIES_DEFAULT },
  { key: "harnessRetries.selfEvolve", group: "harness", kind: "number", min: HARNESS_RETRIES_MIN, max: HARNESS_RETRIES_MAX, step: 1, default: HARNESS_RETRIES_DEFAULT },
  // Defaults mirror config/settings.ts env defaults: the settings UI reset writes
  // meta.default, so a mismatch silently resets these three to other values.
  { key: "subagentMaxSteps", group: "tools", kind: "number", min: 1, max: 100, step: 1, default: 10 },
  { key: "ralphMaxRounds", group: "tools", kind: "number", min: 1, max: 64, step: 1, default: 8 },
  { key: "mcpFetchTimeoutMs", group: "tools", kind: "number", min: 5_000, max: 300_000, step: 5_000, default: 15_000 },
  { key: "agentMaxDelegationDepth", group: "tools", kind: "number", min: 0, max: 3, step: 1, default: 1 },
  { key: "llmTimeoutMs", group: "llm", kind: "number", min: 10_000, max: 600_000, step: 10_000, default: 120_000 },
  { key: "llmMaxRetries", group: "llm", kind: "number", min: 0, max: 5, step: 1, default: 2 },
];

/** The static default knob set (env-derived defaults layer on top in config). */
export function staticDefaultRuntimeKnobs(): RuntimeKnobs {
  // Every value must equal the matching RUNTIME_KNOB_FIELDS meta default (and
  // the config/settings.ts env default): the settings UI reset writes meta.default,
  // so a drift here silently resets operator knobs to other values. Locked by
  // tests/runtime-knobs.test.ts.
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
    selfConsistencyN: SELF_CONSISTENCY_N_DEFAULT,
    totWidth: TOT_WIDTH_DEFAULT,
    crewaiProcess: "sequential",
    harnessRetries: {
      verify: HARNESS_RETRIES_DEFAULT,
      reflect: HARNESS_RETRIES_DEFAULT,
      selfEvolve: HARNESS_RETRIES_DEFAULT,
    },
    subagentMaxSteps: 10,
    ralphMaxRounds: 8,
    mcpFetchTimeoutMs: 15_000,
    agentMaxDelegationDepth: 1,
    llmTimeoutMs: 120_000,
    llmMaxRetries: 2,
  };
}
