/**
 * @file context-instructions/sources
 * @description Layered instruction sources: bundled defaults plus repo/workspace files.
 *
 * Responsibilities:
 * - Ship bundled instruction layers (coding discipline, tool hygiene)
 * - Discover repo-root and workspace AGENTS.md files with precedence
 * - Merge layers lowest-priority-first with same-name workspace wins
 *
 * Precedence (low to high): bundled defaults < repo AGENTS.md < workspace
 * AGENTS.md < workspace AGENTS.local.md. Higher layers replace same-named
 * lower layers; distinct names accumulate in priority order.
 */

export interface InstructionLayer {
  /** Stable kebab-case layer name (workspace layers override same-named bundled ones). */
  name: string;
  /** Short one-line description for digests and listings. */
  description: string;
  /** Full markdown body injected into the prompt. */
  body: string;
  /** Where the layer came from (precedence key). */
  source: "bundled" | "repo" | "workspace";
}

/** Minimal structural read surface (satisfied by ScopedFileSystem and node:fs adapters). */
export interface InstructionFileAccess {
  exists(path: string): boolean;
  readFile(path: string): string;
}

const CODING_DISCIPLINE = `Coding discipline for agent runs.
1. Read before changing: open the target files plus callers/callees before editing.
2. Minimal diffs: every changed line traces to the request; no drive-by refactors.
3. Verify with the project checks (typecheck/tests/boundaries as touched); report
   failed as failed, skipped as skipped — never fake success.
4. No TODO, commented-out code, placeholders, or debug leftovers in finished work.`;

const TOOL_HYGIENE = `Tool hygiene for agent runs.
1. Prefer read/glob/grep before edit; verify with run before declaring done.
2. Keep tool arguments small: paginate listings, cap search output, batch independent calls.
3. Never disable validation, bypass auth, or swallow errors to fake success.`;

const PLAN_DISCIPLINE = `Plan discipline for multi-step work.
1. Draft the approach with the plan tool before editing code on multi-step tasks.
2. Keep the plan sequenced (goal -> steps -> verification) and update it on pivots.
3. Plans are durable workspace documents for post-hoc review, never approval gates.`;

/** Bundled instruction layers (source of truth: repo working agreements). */
export const BUNDLED_INSTRUCTION_LAYERS: readonly InstructionLayer[] = [
  { name: "coding-discipline", description: "Read-first minimal diffs with honest verification", body: CODING_DISCIPLINE, source: "bundled" },
  { name: "tool-hygiene", description: "Lean tool use and honest failure reporting", body: TOOL_HYGIENE, source: "bundled" },
  { name: "plan-discipline", description: "Durable plan-first discipline for multi-step work", body: PLAN_DISCIPLINE, source: "bundled" },
];

/** Candidate instruction files in precedence order (low to high). */
export const INSTRUCTION_FILES = ["AGENTS.md", "AGENTS.local.md"] as const;

/**
 * Loads instruction layers: bundled defaults plus file layers.
 * Missing/unreadable files are skipped (counted, never thrown).
 */
export function loadInstructionLayers(
  files: InstructionFileAccess,
  options: {
    repoFiles?: readonly string[];
    workspaceFiles?: readonly string[];
    /** Include bundled default layers (default true; hosts may ship workspace-only). */
    bundled?: boolean;
  } = {},
): { layers: InstructionLayer[]; skipped: number } {
  const merged = new Map<string, InstructionLayer>();
  if (options.bundled !== false) {
    for (const layer of BUNDLED_INSTRUCTION_LAYERS) merged.set(layer.name, layer);
  }
  let skipped = 0;
  const repoFiles = options.repoFiles ?? [];
  for (const file of repoFiles) {
    try {
      if (!files.exists(file)) continue;
      const body = files.readFile(file).trim();
      if (body === "") {
        skipped += 1;
        continue;
      }
      merged.set(`repo-${file.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, {
        name: `repo-${file.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        description: `Repo instruction file ${file}`,
        body,
        source: "repo",
      });
    } catch {
      skipped += 1;
    }
  }
  const workspaceFiles = options.workspaceFiles ?? [...INSTRUCTION_FILES];
  for (const file of workspaceFiles) {
    try {
      if (!files.exists(file)) continue;
      const body = files.readFile(file).trim();
      if (body === "") {
        skipped += 1;
        continue;
      }
      const name = file.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      merged.set(name, { name, description: `Workspace instruction file ${file}`, body, source: "workspace" });
    } catch {
      skipped += 1;
    }
  }
  return { layers: [...merged.values()], skipped };
}
