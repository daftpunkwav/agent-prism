/**
 * @file baseline-fields
 * @description Baseline panel field projection served to the UI.
 *
 * Responsibilities:
 * - Serve the field list (dimension fields plus baseline-only fields)
 * - Provide default tokens per field
 */

import { DECODE_FIELD_RANGES, DEFAULT_MODEL_ID, DIMENSION_IDS, type DimensionId } from "@agentprism/contracts";
import { DIMENSION_FIELD, type DimensionCatalog } from "@agentprism/dimensions";
import { isFloatField, normalizeOptionToken } from "./field-values.js";

/**
 * Fields edited as validated numeric inputs instead of dropdowns, derived from
 * the shared range table: every field with a DECODE_FIELD_RANGES entry is a
 * numeric editor (and numericMeta can then index that table without a guard,
 * so the two can never drift apart).
 */
const NUMBER_INPUT_FIELDS = new Set<string>(Object.keys(DECODE_FIELD_RANGES));

/** The one numeric field that also accepts the "unlimited" token (no step budget). */
const UNLIMITABLE_FIELDS = new Set(["max_steps"]);

/** Default token of a field in the baseline panel. */
export function baselineDefaultToken(catalog: DimensionCatalog, fieldName: string): string {
  if (isFloatField(fieldName) || fieldName === "max_output_tokens") {
    const raw = catalog.defaultBaseValue(fieldName);
    if (raw !== undefined) return normalizeOptionToken(fieldName, raw);
    if (fieldName === "top_p") return "1";
    if (fieldName === "max_output_tokens") return "96000";
    return "0";
  }
  if (fieldName === "endpoint_id") {
    return String(catalog.defaultBaseValue("endpoint_id") ?? "default");
  }
  if (fieldName === "model_id") {
    return String(catalog.defaultBaseValue("model_id") ?? DEFAULT_MODEL_ID);
  }
  if (fieldName === "max_steps") {
    return String(catalog.defaultBaseValue("max_steps") ?? 10);
  }
  const fromBase = catalog.defaultBaseValue(fieldName);
  if (fromBase !== undefined) return String(fromBase);
  return catalog.firstOptionValue(fieldName);
}

/** Baseline panel field list (dimension fields + baseline-only fields). */
export function listBaselineFields(deps: BaselineFieldsDeps): Array<{
  dimension: DimensionId | null;
  field: string;
  label: string;
  group: string;
  default: string;
  options: Array<{ value: string; label: string }>;
  input: "select" | "number";
  min: number | null;
  max: number | null;
  step: number | null;
  allow_unlimited: boolean;
}> {
  deps.ensureModelSynced();
  const catalog = deps.dimensionCatalog;
  const numericMeta = (fieldName: string): {
    input: "select" | "number";
    min: number | null;
    max: number | null;
    step: number | null;
    allow_unlimited: boolean;
  } => {
    if (!NUMBER_INPUT_FIELDS.has(fieldName)) {
      return { input: "select", min: null, max: null, step: null, allow_unlimited: false };
    }
    const range = DECODE_FIELD_RANGES[fieldName as keyof typeof DECODE_FIELD_RANGES];
    return {
      input: "number",
      min: range.min,
      max: range.max,
      step: range.step,
      allow_unlimited: UNLIMITABLE_FIELDS.has(fieldName),
    };
  };
  const fields: Array<{
    dimension: DimensionId | null;
    field: string;
    label: string;
    group: string;
    default: string;
    options: Array<{ value: string; label: string }>;
    input: "select" | "number";
    min: number | null;
    max: number | null;
    step: number | null;
    allow_unlimited: boolean;
  }> = [];
  for (const dimension of DIMENSION_IDS) {
    const options = catalog.dimensionOptions(dimension);
    const fieldName = DIMENSION_FIELD[dimension];
    fields.push({
      dimension,
      field: fieldName,
      label: catalog.fieldLabel(dimension),
      group: catalog.fieldGroup(fieldName),
      default: baselineDefaultToken(catalog, fieldName),
      options: options.map((option) => ({ value: option.value, label: option.label })),
      ...numericMeta(fieldName),
    });
  }
  for (const [fieldName, options] of Object.entries(catalog.baselineOnlyOptions())) {
    fields.push({
      dimension: null,
      field: fieldName,
      label: catalog.baselineOnlyLabel(fieldName),
      group: catalog.fieldGroup(fieldName),
      default: baselineDefaultToken(catalog, fieldName),
      options: options.map(([value, label]) => ({ value, label })),
      ...numericMeta(fieldName),
    });
  }
  return fields;
}

/** Dependencies for the baseline panel field projection. */
export interface BaselineFieldsDeps {
  dimensionCatalog: DimensionCatalog;
  ensureModelSynced: () => void;
}
