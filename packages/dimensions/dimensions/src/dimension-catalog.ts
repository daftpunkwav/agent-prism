/**
 * @file dimension-catalog
 * @description Static dimension options plus a runtime-syncable mutable view.
 *
 * Responsibilities:
 * - Hold static option definitions per dimension
 * - Expose the mutable view synced at runtime (framework/model options, baseline defaults)
 *
 * Router/baseline and the meta endpoint read the same instance; separate
 * option tables elsewhere are forbidden.
 */

import { DECODE_FIELD_RANGES, dimensionFieldName, type DimensionId } from "@agentprism/contracts";
import { BASELINE_ONLY_LABELS, BASELINE_ONLY_OPTIONS, FIELD_GROUP, FIELD_LABELS, FIELD_NAME_LABELS, FIELD_SUBTITLES, type DimensionOptionTriple } from "./fields.js";
import { FRAMEWORK_OPTIONS } from "./dimensions/framework.js";
import { MAX_STEPS_OPTIONS } from "./dimensions/max-steps.js";
import { MODEL_OPTIONS } from "./dimensions/model.js";
import { TEMPERATURE_OPTIONS } from "./dimensions/temperature.js";
import { THINKING_BUDGET_OPTIONS, THINKING_OPTIONS } from "./dimensions/thinking.js";
import { MCP_OPTIONS } from "./dimensions/mcp.js";
import { SKILL_POLICY_OPTIONS } from "./dimensions/skill.js";
import { ORCHESTRATION_OPTIONS } from "./dimensions/orchestration.js";
import { MEMORY_OPTIONS } from "./dimensions/memory.js";
import { HISTORY_MODE_OPTIONS } from "./dimensions/history-mode.js";

/** Static fallback options per dimension.
 *  Capability dims (prompt/reasoning/context/harness/toolset) start empty and are
 *  filled at startup by the capability sync (the arena option projection, applied
 *  through setDimensionOptions) from the registered capability ids.
 *  Framework/model/thinking are overwritten by provider/driver sync; temperature/
 *  max_steps stay static (no runtime registry). thinking_budget's options are
 *  provider-synced too (budget pair levels or empty); the static list below is
 *  only the pre-sync fallback.
 */
const STATIC_DIMENSION_OPTIONS: Record<DimensionId, DimensionOptionTriple[]> = {
  framework: FRAMEWORK_OPTIONS,
  prompt: [],
  reasoning: [],
  context: [],
  harness: [],
  temperature: TEMPERATURE_OPTIONS,
  model: MODEL_OPTIONS,
  thinking: THINKING_OPTIONS,
  thinking_budget: THINKING_BUDGET_OPTIONS,
  max_steps: MAX_STEPS_OPTIONS,
  toolset: [],
  mcp: MCP_OPTIONS,
  skill: SKILL_POLICY_OPTIONS,
  orchestration: ORCHESTRATION_OPTIONS,
  memory: MEMORY_OPTIONS,
  history_mode: HISTORY_MODE_OPTIONS,
};

/** Pipeline defaults (the controlled-variable baseline; endpoint/decode fields are injected from Provider at runtime). */
const STATIC_DEFAULT_BASE: Record<string, string | number> = {
  framework: "native",
  reasoning: "react",
  context: "sliding",
  harness: "bare",
  prompt_profile: "zero_shot",
  prompt_version: "v1.0.0",
  max_steps: 10,
  toolset: "full",
  mcp_policy: "off",
  skill_policy: "on_demand",
  approval_mode: "auto",
  sandbox_mode: "off",
  orchestration: "direct",
  memory: "none",
  thinking_budget: 0,
  thinking_mode: "levels",
  history_mode: "minimal",
};

/** Registry of experiment dimensions and their selectable options. */
export class DimensionCatalog {
  private defaultBase: Record<string, string | number>;
  private readonly options = new Map<string, DimensionOptionTriple[]>();
  private readonly baselineFieldOptions = new Map<string, DimensionOptionTriple[]>();
  private baselineOptionValues = new Map<string, Set<string>>();

  constructor() {
    this.defaultBase = { ...STATIC_DEFAULT_BASE };
    for (const [dimension, triples] of Object.entries(STATIC_DIMENSION_OPTIONS)) {
      this.options.set(dimension, triples.map((t) => ({ ...t })));
    }
    this.refreshBaselineOptionValues();
  }

  /** Snapshot of the options for one dimension (builtin id or registered custom id). */
  dimensionOptions(dimension: string): DimensionOptionTriple[] {
    return (this.options.get(dimension) ?? []).map((t) => ({ ...t }));
  }

  /** Overrides dimension options (sync entry point for framework/model/custom dimensions). */
  setDimensionOptions(dimension: string, triples: DimensionOptionTriple[]): void {
    this.options.set(dimension, triples.map((t) => ({ ...t })));
    this.refreshBaselineOptionValues();
  }

  get defaultBaseValues(): Record<string, string | number> {
    return { ...this.defaultBase };
  }

  defaultBaseValue(key: string): string | number | undefined {
    return this.defaultBase[key];
  }

  setDefaultBase(key: string, value: string | number): void {
    this.defaultBase[key] = value;
  }

  /** Serializes baseline defaults (returned to the frontend via meta; numbers become strings). */
  baselineDefaultsPayload(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.defaultBase)) {
      out[key] = String(value);
    }
    return out;
  }

  modelCompareReady(): boolean {
    return (this.options.get("model") ?? []).length >= 2;
  }

  /**
   * Overrides a baseline-only field's option table (sync entry point). The
   * override wins over the static BASELINE_ONLY_OPTIONS table everywhere the
   * field surfaces: meta payload, legality validation, and option listing.
   */
  setBaselineFieldOptions(field: string, triples: DimensionOptionTriple[]): void {
    this.baselineFieldOptions.set(field, triples.map((t) => ({ ...t })));
    this.refreshBaselineOptionValues();
  }

  /** Option table for baseline-only control variables. */
  baselineOnlyOptions(): Record<string, Array<[string, string]>> {
    const out: Record<string, Array<[string, string]>> = {};
    for (const [field, options] of Object.entries(BASELINE_ONLY_OPTIONS)) {
      out[field] = options.map((o) => [o[0], o[1]]);
    }
    for (const [field, triples] of this.baselineFieldOptions) {
      out[field] = triples.map((t) => [t.value, t.label]);
    }
    return out;
  }

  baselineOnlyLabel(fieldName: string): string {
    return BASELINE_ONLY_LABELS[fieldName] ?? fieldName;
  }

  fieldLabel(fieldName: string): string {
    return FIELD_LABELS[fieldName] ?? fieldName;
  }

  /** Dimension id → purpose description (subtitle of the dimension card in the Arena UI). */
  fieldSubtitle(dimensionId: string): string {
    return FIELD_SUBTITLES[dimensionId] ?? "";
  }

  /** Display name by config field name (kept separate from dimension id labels). */
  fieldDisplayLabel(field: string): string {
    return FIELD_NAME_LABELS[field] ?? field;
  }

  fieldGroup(fieldName: string): string {
    return FIELD_GROUP[fieldName] ?? "pipeline";
  }

  /** Rebuilds the "field → legal values" validation sets from current options. */
  refreshBaselineOptionValues(): void {
    const values = new Map<string, Set<string>>();
    for (const [dimension, triples] of this.options) {
      values.set(dimensionFieldName(dimension), new Set(triples.map((t) => t.value)));
    }
    for (const [field, optionPairs] of Object.entries(BASELINE_ONLY_OPTIONS)) {
      values.set(field, new Set(optionPairs.map(([v]) => v)));
    }
    // Runtime overrides express endpoint-dependent legality (e.g. budget pairs
    // only exist on anthropic_messages endpoints) and must win over the static
    // table, or a pin the UI never offered would still pass validation.
    for (const [field, triples] of this.baselineFieldOptions) {
      values.set(field, new Set(triples.map((t) => t.value)));
    }
    this.baselineOptionValues = values;
  }

  /**
   * Whether a baseline token is legal for a field. Numeric baseline fields
   * (every field with a DECODE_FIELD_RANGES entry: decode parameters plus
   * max_steps) accept any in-range number; max_steps additionally accepts the
   * "unlimited" token / -1 sentinel (no step budget). Every non-numeric field
   * stays pinned to its option list.
   */
  isLegalFieldValue(field: string, token: string): boolean {
    if (field === "max_steps") {
      const trimmed = token.trim();
      if (trimmed === "") return false;
      if (trimmed === "unlimited" || trimmed === "-1") return true;
      const range = DECODE_FIELD_RANGES.max_steps;
      const value = Number(trimmed);
      return Number.isFinite(value) && value >= range.min && value <= range.max;
    }
    if (field in DECODE_FIELD_RANGES) {
      const range = DECODE_FIELD_RANGES[field as keyof typeof DECODE_FIELD_RANGES];
      const trimmed = token.trim();
      if (trimmed === "") return false;
      const value = Number(trimmed);
      return Number.isFinite(value) && value >= range.min && value <= range.max;
    }
    return this.baselineOptionValues.get(field)?.has(token) ?? false;
  }

  isKnownField(field: string): boolean {
    return this.baselineOptionValues.has(field);
  }

  /** Default value for a field: falls back to the first option of that field's dimension. */
  firstOptionValue(field: string): string {
    for (const dimension of this.options.keys()) {
      if (dimensionFieldName(dimension) !== field) continue;
      const first = this.options.get(dimension)?.[0]?.value;
      if (first !== undefined) return first;
    }
    return "";
  }
}

export type { DimensionOptionTriple };
