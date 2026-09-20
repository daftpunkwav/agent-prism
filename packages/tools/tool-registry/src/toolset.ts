/**
 * @file toolset
 * @description Toolset resolution from the contracts single source.
 *
 * Responsibilities:
 * - Derive tool-name sets per toolset id
 * - Normalize legacy aliases and apply fail-closed defaults
 * - Select matching registry entries for a resolved set
 */

import { TOOL_NAMES_BY_TOOLSET, type ToolRegistry, type ToolsetId } from "@agentprism/contracts";

/** Toolset → tool-name set (derived from the contracts single source of truth). */
export const TOOLSET_TOOLS: Record<ToolsetId, ReadonlySet<string>> = {
  full: new Set(TOOL_NAMES_BY_TOOLSET.full),
  edit_run: new Set(TOOL_NAMES_BY_TOOLSET.edit_run),
  read_only: new Set(TOOL_NAMES_BY_TOOLSET.read_only),
};

const LEGACY_ALIASES: Record<string, ToolsetId> = {
  code_file: "edit_run",
  calc_time: "read_only",
  workspace_read: "read_only",
};

/**
 * Legal values pass through; unknown non-empty normalizes to read_only (fail-closed).
 * A typo in a restrictive config must never silently escalate to full; the request-entry
 * zod schema already rejects illegal values, and this fallback covers legacy persisted data.
 */
export function normalizeToolset(toolset: string | null | undefined): ToolsetId {
  if (toolset === "full" || toolset === "edit_run" || toolset === "read_only") return toolset;
  return "read_only";
}

/** Resolves legacy aliases to a toolset id; empty/unset resolves to full (default); unknown non-empty normalizes to read_only (fail-closed) via normalizeToolset. */
export function resolveToolsetId(toolset: string | null | undefined): ToolsetId {
  if (toolset === undefined || toolset === null || toolset === "") return "full";
  const aliased = LEGACY_ALIASES[toolset];
  if (aliased !== undefined) return aliased;
  return normalizeToolset(toolset);
}

/** Tool names allowed by the toolset (sorted for stability). Missing mapping entries fall back to read_only. */
export function selectToolNames(toolset: string | null | undefined): string[] {
  const mapping = TOOLSET_TOOLS[resolveToolsetId(toolset)] ?? TOOLSET_TOOLS.read_only;
  return [...mapping].sort();
}

/** Returns a registry view limited to the toolset's authorized names. */
export function selectToolRegistry(registry: ToolRegistry, toolset: string | null | undefined): ToolRegistry {
  return registry.select(selectToolNames(toolset));
}
