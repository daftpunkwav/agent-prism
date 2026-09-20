/**
 * @file dimensions/memory
 * @description Static options for the cross-session memory dimension.
 *
 * Responsibilities:
 * - Export MEMORY_OPTIONS consumed by the dimension catalog
 */

import type { DimensionOptionTriple } from "../fields.js";

export const MEMORY_OPTIONS: DimensionOptionTriple[] = [
  { field: "memory", value: "none", label: "No memory (stateless)" },
  { field: "memory", value: "episodic", label: "Episodic (past task experience)" },
  { field: "memory", value: "semantic", label: "Semantic (project facts)" },
  { field: "memory", value: "full", label: "Full (episodic + semantic)" },
];
