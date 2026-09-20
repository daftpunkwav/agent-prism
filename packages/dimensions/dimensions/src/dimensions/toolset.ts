/**
 * @file dimensions/toolset
 * @description Static options for the toolset dimension.
 *
 * Responsibilities:
 * - Export TOOLSET_OPTIONS consumed by the dimension catalog
 */

import type { DimensionOptionTriple } from "../fields.js";

export const TOOLSET_OPTIONS: DimensionOptionTriple[] = [
  { field: "toolset", value: "full", label: "Full tools" },
  { field: "toolset", value: "edit_run", label: "Read/write + run" },
  { field: "toolset", value: "read_only", label: "Read-only" },
];
