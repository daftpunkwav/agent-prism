/**
 * @file dimensions/prompt
 * @description Static options for the prompt-template dimension.
 *
 * Responsibilities:
 * - Export PROMPT_OPTIONS consumed by the dimension catalog
 */

import type { DimensionOptionTriple } from "../fields.js";

export const PROMPT_OPTIONS: DimensionOptionTriple[] = [
  { field: "prompt_profile", value: "zero_shot", label: "Zero-shot" },
  { field: "prompt_profile", value: "few_shot", label: "Few-shot" },
  { field: "prompt_profile", value: "cot_prompt", label: "CoT Prompt" },
  { field: "prompt_profile", value: "structured", label: "Structured" },
  { field: "prompt_profile", value: "terse", label: "Terse" },
];
