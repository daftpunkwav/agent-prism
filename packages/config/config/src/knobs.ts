/**
 * @file knobs
 * @description Operator-tunable runtime knobs: env-derived defaults, normalization, store.
 *
 * Responsibilities:
 * - Derive default knobs from the env-loaded Settings
 * - Normalize arbitrary input (settings API payloads) with clamping
 * - Persist overrides and notify a hot-apply callback on update
 *
 * The knob types and field metadata live in contracts (runtime-knobs) so the
 * web client shares them; defaults here must stay in sync with the driver-side
 * fallbacks (driver-registry reasoning-constants) and harness loop caps.
 */

import type { JsonFile } from "@agentprism/persistence";
import type { RuntimeKnobFieldMeta, RuntimeKnobs } from "@agentprism/contracts";
import { RUNTIME_KNOB_FIELDS, staticDefaultRuntimeKnobs } from "@agentprism/contracts";
import type { Settings } from "./settings.js";

export type { HarnessRetriesKnobs, RuntimeKnobFieldMeta, RuntimeKnobs } from "@agentprism/contracts";
export { RUNTIME_KNOB_FIELDS };

/** Derives the env-backed defaults (Settings already applied the CONTEXT_* and LLM_* env reads). */
export function defaultRuntimeKnobs(settings: Settings): RuntimeKnobs {
  const fallback = staticDefaultRuntimeKnobs();
  const clamped = (value: number, key: string): number => {
    const meta = RUNTIME_KNOB_FIELDS.find((field) => field.key === key);
    if (meta === undefined || meta.kind !== "number") return value;
    const min = meta.min ?? -Number.MAX_SAFE_INTEGER;
    const max = meta.max ?? Number.MAX_SAFE_INTEGER;
    return Math.min(max, Math.max(min, Math.trunc(value)));
  };
  return {
    contextWindowMessages: clamped(settings.contextWindowMessages, "contextWindowMessages"),
    contextCharsPerToken: clamped(settings.contextCharsPerToken, "contextCharsPerToken"),
    contextSummaryMaxChars: clamped(settings.contextSummaryMaxChars, "contextSummaryMaxChars"),
    contextTokenBudgetChars: clamped(settings.contextTokenBudgetChars, "contextTokenBudgetChars"),
    contextTokenBudgetKeepTurns: clamped(settings.contextTokenBudgetKeepTurns, "contextTokenBudgetKeepTurns"),
    contextToolTailBudgetChars: clamped(settings.contextToolTailBudgetChars, "contextToolTailBudgetChars"),
    contextToolTailKeepChars: clamped(settings.contextToolTailKeepChars, "contextToolTailKeepChars"),
    contextBudgetTokens: clamped(settings.contextBudgetTokens, "contextBudgetTokens"),
    contextCheckpointTargetTokens: clamped(settings.contextCheckpointTargetTokens, "contextCheckpointTargetTokens"),
    selfConsistencyN: fallback.selfConsistencyN,
    totWidth: fallback.totWidth,
    crewaiProcess: fallback.crewaiProcess,
    harnessRetries: { ...fallback.harnessRetries },
    subagentMaxSteps: clamped(settings.toolSubagentMaxSteps, "subagentMaxSteps"),
    ralphMaxRounds: clamped(settings.toolRalphMaxRounds, "ralphMaxRounds"),
    mcpFetchTimeoutMs: clamped(settings.mcpFetchTimeoutMs, "mcpFetchTimeoutMs"),
    agentMaxDelegationDepth: clamped(settings.agentMaxDelegationDepth, "agentMaxDelegationDepth"),
    llmTimeoutMs: clamped(settings.llmTimeoutMs, "llmTimeoutMs"),
    llmMaxRetries: clamped(settings.llmMaxRetries, "llmMaxRetries"),
  };
}

function clampField(meta: RuntimeKnobFieldMeta | undefined, raw: unknown, fallback: number | string): number | string {
  if (meta === undefined) return fallback;
  if (meta.kind === "select") {
    return typeof raw === "string" && meta.options?.includes(raw) ? raw : fallback;
  }
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num)) return fallback;
  const min = meta.min ?? -Number.MAX_SAFE_INTEGER;
  const max = meta.max ?? Number.MAX_SAFE_INTEGER;
  return Math.min(max, Math.max(min, Math.trunc(num)));
}

/** Normalizes an arbitrary payload (settings PUT body or stored file) over the current values. */
export function normalizeRuntimeKnobs(raw: unknown, base: RuntimeKnobs): RuntimeKnobs {
  const source = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const numeric = (key: string, fallback: number): number => {
    const meta = RUNTIME_KNOB_FIELDS.find((field) => field.key === key);
    return clampField(meta, source[key], fallback) as number;
  };
  const retry = (key: "verify" | "reflect" | "selfEvolve"): number => {
    const meta = RUNTIME_KNOB_FIELDS.find((field) => field.key === `harnessRetries.${key}`);
    const retries = typeof source.harnessRetries === "object" && source.harnessRetries !== null
      ? (source.harnessRetries as Record<string, unknown>)
      : {};
    return clampField(meta, retries[key], base.harnessRetries[key]) as number;
  };
  const crewaiProcess = typeof source.crewaiProcess === "string" && source.crewaiProcess === "hierarchical"
    ? "hierarchical"
    : base.crewaiProcess;
  return {
    contextWindowMessages: numeric("contextWindowMessages", base.contextWindowMessages),
    contextCharsPerToken: numeric("contextCharsPerToken", base.contextCharsPerToken),
    contextSummaryMaxChars: numeric("contextSummaryMaxChars", base.contextSummaryMaxChars),
    contextTokenBudgetChars: numeric("contextTokenBudgetChars", base.contextTokenBudgetChars),
    contextTokenBudgetKeepTurns: numeric("contextTokenBudgetKeepTurns", base.contextTokenBudgetKeepTurns),
    contextToolTailBudgetChars: numeric("contextToolTailBudgetChars", base.contextToolTailBudgetChars),
    contextToolTailKeepChars: numeric("contextToolTailKeepChars", base.contextToolTailKeepChars),
    contextBudgetTokens: numeric("contextBudgetTokens", base.contextBudgetTokens),
    contextCheckpointTargetTokens: numeric("contextCheckpointTargetTokens", base.contextCheckpointTargetTokens),
    selfConsistencyN: numeric("selfConsistencyN", base.selfConsistencyN),
    totWidth: numeric("totWidth", base.totWidth),
    crewaiProcess,
    subagentMaxSteps: numeric("subagentMaxSteps", base.subagentMaxSteps),
    ralphMaxRounds: numeric("ralphMaxRounds", base.ralphMaxRounds),
    mcpFetchTimeoutMs: numeric("mcpFetchTimeoutMs", base.mcpFetchTimeoutMs),
    agentMaxDelegationDepth: numeric("agentMaxDelegationDepth", base.agentMaxDelegationDepth),
    llmTimeoutMs: numeric("llmTimeoutMs", base.llmTimeoutMs),
    llmMaxRetries: numeric("llmMaxRetries", base.llmMaxRetries),
    harnessRetries: {
      verify: retry("verify"),
      reflect: retry("reflect"),
      selfEvolve: retry("selfEvolve"),
    },
  };
}

/**
 * Live knob store: file-backed overrides over env-derived defaults. `onUpdate`
 * fires after every accepted update so the host can hot-apply the values
 * (shared ContextTuning mutation, driver env writes) without a restart.
 */
export class RuntimeKnobsStore {
  private currentKnobs: RuntimeKnobs;

  constructor(
    private readonly file: JsonFile,
    base: RuntimeKnobs,
    private readonly onUpdate?: (knobs: RuntimeKnobs) => void,
  ) {
    // Saved overrides win over env defaults; a missing/corrupt file keeps defaults.
    let saved: unknown = null;
    try {
      saved = file.read();
    } catch {
      saved = null;
    }
    this.currentKnobs = normalizeRuntimeKnobs(saved, base);
  }

  current(): RuntimeKnobs {
    return this.currentKnobs;
  }

  /**
   * Normalizes, persists, hot-applies, and returns the new knobs.
   * Persistence lands before the hot-apply: a failed write throws (the route
   * answers 5xx) and leaves the live knobs untouched, so the operator never
   * sees "saved" while a restart would silently revert the values.
   */
  async update(raw: unknown): Promise<RuntimeKnobs> {
    const next = normalizeRuntimeKnobs(raw, this.currentKnobs);
    await this.file.write(next);
    this.currentKnobs = next;
    this.onUpdate?.(next);
    return next;
  }
}
