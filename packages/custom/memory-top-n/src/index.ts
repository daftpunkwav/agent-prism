/**
 * @file memory-top-n
 * @description Custom dimension: how many recalled memories reach the prompt.
 *
 * Responsibilities:
 * - Declare the memory-top-n dimension and its options
 * - Shape the recall result and the render caps (the hook)
 *
 * Memory mounting caps mounted lines per layer (`MEMORY_BLOCK_LIMITS`, 3 episodic
 * / 5 semantic) — a fixed budget that silently truncates a richer recall. This
 * dimension makes the budget the comparison axis: "all" mounts everything the
 * retrieval returned, "top3"/"top10" mount a fixed prefix of each layer.
 *
 * It is also the worked example of a hook that must move two things at once: the
 * render caps alone cannot widen a recall that the memory service already limited,
 * and a recall-wide slice alone still gets truncated at render time.
 *
 * Reference implementation for a custom dimension package.
 */

import type { CustomDimension, CustomMemoryInput, MemoryRecallResult } from "@agentprism/contracts";

/** Caps for an explicit top-N choice. */
const TOP_N: Record<string, number> = { top3: 3, top10: 10 };

/** Recalls everything the memory service returned (caps effectively removed). */
const MOUNT_ALL = Number.MAX_SAFE_INTEGER;

/** Resolved caps for one option value: null when the recall should pass through unchanged. */
export function memoryLimitsFor(value: string): { episodic: number; semantic: number } | null {
  const top = TOP_N[value];
  if (top !== undefined) return { episodic: top, semantic: top };
  if (value === "all") return { episodic: MOUNT_ALL, semantic: MOUNT_ALL };
  return null;
}

/** Truncates both layers to one shared limit (the recall half of the hook). */
function limitRecall(recall: MemoryRecallResult, limit: number): MemoryRecallResult {
  return {
    episodic: recall.episodic.slice(0, limit),
    semantic: recall.semantic.slice(0, limit),
  };
}

/** The memory-top-n dimension: mount all recalled memories, or the first 3 / 10. */
export const memoryTopNDimension: CustomDimension = {
  id: "memory_top_n",
  label: "Memory recall depth",
  subtitle: "How many recalled memory entries are mounted into the prompt",
  options: [
    { value: "top3", label: "Top 3", description: "Mount the first 3 entries per layer (tightest context)." },
    { value: "top10", label: "Top 10", description: "Mount the first 10 entries per layer." },
    { value: "all", label: "All recalled", description: "Mount every recalled entry (widest context)." },
  ],
  default: "top3",
  promptHint: "\n[Memory: recall depth {value}]",
  hooks: {
    memory: (input: CustomMemoryInput, value) => {
      const limits = memoryLimitsFor(value);
      if (limits === null) return undefined;
      const recall = input.recall;
      const top = TOP_N[value];
      return {
        recall: recall !== undefined && top !== undefined ? limitRecall(recall, top) : recall,
        limits,
      };
    },
  },
};
