/**
 * @file custom-dimensions
 * @description Registry of externally contributed comparison dimensions.
 *
 * Responsibilities:
 * - Hold CustomDimension instances registered at the composition root
 * - Validate contributed descriptors at registration (fail loud on authoring errors)
 * - Resolve a run's configured values into the active dimensions of that run
 *
 * Module-level registry, same shape as the other registry seams (driver registry,
 * prompt section registry): subpackages export descriptors, the composition root
 * registers them, and the Arena projection, the Builder catalog, and the run
 * pipeline all read the same map — so a registered dimension is always
 * selectable, blockable, and runnable, and an unregistered id fails loudly.
 */

import type { CustomDimension } from "@agentprism/contracts";
import {
  CUSTOM_DIMENSION_ID_MAX,
  CUSTOM_DIMENSION_ID_RE,
  CUSTOM_DIMENSION_VALUE_MAX,
  isBuiltinContextStrategy,
  isBuiltinDimensionId,
} from "@agentprism/contracts";

/** Registered dimensions in insertion order; registration is idempotent per id. */
const customDimensions = new Map<string, CustomDimension>();

/** Rejects descriptors that would be unresolvable, unrenderable, or ambiguous. */
function assertRegisterable(dimension: CustomDimension): void {
  if (!CUSTOM_DIMENSION_ID_RE.test(dimension.id)) {
    throw new TypeError(
      `CustomDimension.id "${dimension.id}" must be lower_snake_case (letters, digits, underscore; max ${CUSTOM_DIMENSION_ID_MAX} chars)`,
    );
  }
  if (isBuiltinDimensionId(dimension.id)) {
    throw new TypeError(
      `CustomDimension.id "${dimension.id}" collides with a builtin dimension; it would never surface as its own axis`,
    );
  }
  if (isBuiltinContextStrategy(dimension.id)) {
    throw new TypeError(
      `CustomDimension.id "${dimension.id}" collides with a builtin context strategy; the run's effectiveness rows for this dimension and for that strategy would merge into one`,
    );
  }
  if (dimension.label.trim() === "") {
    throw new TypeError(`CustomDimension "${dimension.id}" must declare a non-empty label`);
  }
  if (dimension.options.length === 0) {
    throw new TypeError(`CustomDimension "${dimension.id}" must declare at least one option`);
  }
  const values = new Set<string>();
  for (const option of dimension.options) {
    if (option.value.trim() === "" || option.value !== option.value.trim()) {
      throw new TypeError(`CustomDimension "${dimension.id}" has an empty or padded option value ("${option.value}")`);
    }
    if (option.value.length > CUSTOM_DIMENSION_VALUE_MAX) {
      throw new TypeError(
        `CustomDimension "${dimension.id}" option "${option.value.slice(0, 40)}…" exceeds ${CUSTOM_DIMENSION_VALUE_MAX} chars, the bound of every persisted config record`,
      );
    }
    if (values.has(option.value)) {
      throw new TypeError(`CustomDimension "${dimension.id}" declares duplicate option value "${option.value}"`);
    }
    values.add(option.value);
    if (option.label.trim() === "") {
      throw new TypeError(`CustomDimension "${dimension.id}" option "${option.value}" must declare a non-empty label`);
    }
  }
  const declaredDefault = dimension.default;
  if (declaredDefault !== undefined && !values.has(declaredDefault)) {
    throw new TypeError(
      `CustomDimension "${dimension.id}" default "${declaredDefault}" is not one of its options`,
    );
  }
  const existing = customDimensions.get(dimension.id);
  if (existing !== undefined && existing !== dimension) {
    throw new TypeError(`CustomDimension id "${dimension.id}" is already registered by another package`);
  }
}

/** Registers custom comparison dimensions (called once at the composition root). */
export function registerCustomDimensions(dimensions: readonly CustomDimension[]): void {
  for (const dimension of dimensions) {
    assertRegisterable(dimension);
    customDimensions.set(dimension.id, dimension);
  }
}

/** Lists the registered dimensions in registration order. */
export function listCustomDimensions(): CustomDimension[] {
  return [...customDimensions.values()];
}

/** Returns the registered dimension with the given id, or undefined. */
export function customDimension(id: string): CustomDimension | undefined {
  return customDimensions.get(id);
}

/** Default value of a dimension (the declared default, else its first option). */
export function customDimensionDefault(dimension: CustomDimension): string {
  return dimension.default ?? dimension.options[0]?.value ?? "";
}

/** One activation of a custom dimension inside a run: the descriptor plus the selected value. */
export interface ActiveCustomDimension {
  dimension: CustomDimension;
  value: string;
}

/**
 * Resolves a run's configured values into active dimensions, in registration
 * order (deterministic hook order across columns).
 *
 * `configuredValues` is the run's `custom` record (`{ [dimensionId]: optionValue }`);
 * the name keeps it apart from `option.value`, the legal values it is validated
 * against below.
 *
 * @throws Error naming every id that has no registered dimension: a config
 *   carrying a removed or typo'd dimension must fail loudly instead of running a
 *   silently different experiment.
 */
export function resolveCustomDimensions(
  configuredValues: Readonly<Record<string, string>> | undefined,
): ActiveCustomDimension[] {
  if (configuredValues === undefined) return [];
  const ids = Object.keys(configuredValues);
  if (ids.length === 0) return [];
  const missing = ids.filter((id) => !customDimensions.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Unknown custom dimension(s): ${missing.join(", ")} (registered: ${[...customDimensions.keys()].join(", ") || "none"})`,
    );
  }
  // Values are validated here as well as at configure time: a session stored
  // before its package changed its option list must fail loudly, not run under a
  // value the dimension no longer defines.
  for (const id of ids) {
    const dimension = customDimensions.get(id);
    const value = configuredValues[id] as string;
    if (dimension === undefined || dimension.options.some((option) => option.value === value)) continue;
    throw new Error(
      `Custom dimension "${id}" has unsupported value "${value}" (options: ${dimension.options.map((o) => o.value).join(", ")})`,
    );
  }
  const active: ActiveCustomDimension[] = [];
  for (const dimension of customDimensions.values()) {
    // Own keys only: the id grammar allows names that exist on Object.prototype
    // ("constructor"), and a plain read would resolve an unset id to the inherited
    // member — handing a hook a non-string where the configured value belongs.
    if (!Object.hasOwn(configuredValues, dimension.id)) continue;
    active.push({ dimension, value: configuredValues[dimension.id] as string });
  }
  return active;
}
