/**
 * @file custom-dimension-rows
 * @description Arena-facing projection of the registered custom comparison dimensions.
 *
 * Responsibilities:
 * - Read the harness registry once and shape it for the arena surfaces
 * - Give /meta, the baseline panel, and the option projection one shared row shape
 *
 * The registry itself lives in harness (it also serves the run pipeline); this
 * module is the arena/builder view of it — one row per registered dimension —
 * while the package barrel re-exports the registry entry points, so domain
 * packages depend on the dimension layer rather than reaching into the harness.
 */

import type { CustomDimension } from "@agentprism/contracts";
import { customFieldKey } from "@agentprism/contracts";
import type { DimensionOptionTriple } from "@agentprism/dimensions";
import { customDimensionDefault, listCustomDimensions } from "@agentprism/harness";

/** One registered custom dimension as the arena surfaces consume it. */
export interface CustomDimensionRow {
  id: string;
  label: string;
  subtitle: string;
  /** Synthetic field name this dimension's value occupies (`custom.<id>`). */
  field: string;
  /** Effective default (the declared default, else the first option). */
  default: string;
  options: DimensionOptionTriple[];
}

/** Rows of every registered custom dimension, in registration order. */
export function listCustomDimensionRows(): CustomDimensionRow[] {
  return listCustomDimensions().map((dimension: CustomDimension) => ({
    id: dimension.id,
    label: dimension.label,
    subtitle: dimension.subtitle ?? "",
    field: customFieldKey(dimension.id),
    default: customDimensionDefault(dimension),
    options: dimension.options.map((option) => ({
      field: customFieldKey(dimension.id),
      value: option.value,
      label: option.label,
      // Authored in the package; surfaces as the palette chip's tooltip.
      ...(option.description === undefined ? {} : { description: option.description }),
    })),
  }));
}
