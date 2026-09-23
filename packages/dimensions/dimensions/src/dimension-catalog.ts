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

import { DECODE_FIELD_RANGES, type DimensionId } from "@agentprism/contracts";
import { BASELINE_ONLY_LABELS, BASELINE_ONLY_OPTIONS, DIMENSION_FIELD, FIELD_GROUP, FIELD_LABELS, FIELD_NAME_LABELS, FIELD_SUBTITLES, type DimensionOptionTriple } from "./fields.js";
import { FRAMEWORK_OPTIONS } from "./dimensions/framework.js";
import { MAX_STEPS_OPTIONS } from "./dimensions/max-steps.js";
import { MODEL_OPTIONS } from "./dimensions/model.js";
import { TEMPERATURE_OPTIONS } from "./dimensions/temperature.js";
import { THINKING_OPTIONS } from "./dimensions/thinking.js";
import { MCP_OPTIONS } from "./dimensions/mcp.js";
import { SKILL_POLICY_OPTIONS } from "./dimensions/skill.js";
import { ORCHESTRATION_OPTIONS } from "./dimensions/orchestration.js";
import { MEMORY_OPTIONS } from "./dimensions/memory.js";
import { HISTORY_MODE_OPTIONS } from "./dimensions/history-mode.js";

/** Static fallback options per dimension.
 *  Capability dims (prompt/reasoning/context/harness/toolset) start empty and are
 *  filled by syncCapabilityOptions from registered plugin ids.
 *  Framework/model are overwritten by provider/driver sync; temperature/thinking/
 *  max_steps stay static (no runtime registry).
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
  history_mode: "minimal",
};

/** Registry of experiment dimensions and their selectable options. */
export class DimensionCatalog {
  private defaultBase: Record<string, string | number>;
  private readonly options = new Map<DimensionId, DimensionOptionTriple[]>();
  private baselineOptionValues = new Map<string, Set<string>>();

  constructor() {
    this.defaultBase = { ...STATIC_DEFAULT_BASE };
    for (const [dimension, triples] of Object.entries(STATIC_DIMENSION_OPTIONS)) {
      this.options.set(dimension as DimensionId, triples.map((t) => ({ ...t })));
    }
    this.refreshBaselineOptionValues();
  }

  /** Snapshot of the options for one dimension. */
  dimensionOptions(dimension: DimensionId): DimensionOptionTriple[] {
    return (this.options.get(dimension) ?? []).map((t) => ({ ...t }));
  }

  /** Overrides dimension options (the sync entry point for framework/model). */
  setDimensionOptions(dimension: DimensionId, triples: DimensionOptionTriple[]): void {
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

  /** Option table for baseline-only control variables. */
  baselineOnlyOptions(): Record<string, Array<[string, string]>> {
    const out: Record<string, Array<[string, string]>> = {};
    for (const [field, options] of Object.entries(BASELINE_ONLY_OPTIONS)) {
      out[field] = options.map((o) => [o[0], o[1]]);
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
      values.set(DIMENSION_FIELD[dimension], new Set(triples.map((t) => t.value)));
    }
    for (const [field, optionPairs] of Object.entries(BASELINE_ONLY_OPTIONS)) {
      values.set(field, new Set(optionPairs.map(([v]) => v)));
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
    for (const [dimension, fieldName] of Object.entries(DIMENSION_FIELD)) {
      if (fieldName === field) {
        const options = this.options.get(dimension as DimensionId) ?? [];
        const first = options[0]?.value;
        if (first !== undefined) return first;
      }
    }
    return "";
  }
}

export type { DimensionOptionTriple };
