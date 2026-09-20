/**
 * @file prompt/instructions
 * @description Workspace instruction layers rendered into the system prompt.
 *
 * Responsibilities:
 * - Adapt the workspace filesystem to the InstructionFileAccess port
 * - Load workspace AGENTS.md/AGENTS.local.md layers (bundled defaults off)
 * - Render the budgeted instruction block (empty when no files exist)
 *
 * Bundled library layers stay out of runtime prompts by default: runs stay
 * byte-identical until a workspace actually provides instruction files.
 */

import { InstructionState, loadInstructionLayers, renderInstructions, type InstructionFileAccess } from "@agentprism/context-instructions";

/** Workspace files consulted for instruction layers (precedence high to low). */
const WORKSPACE_INSTRUCTION_FILES = ["AGENTS.md", "AGENTS.local.md"] as const;

/** Rendered instruction budget in chars (matches the library default). */
const INSTRUCTIONS_BUDGET_CHARS = 6000;

/** Adapts a structural workspace fs to the instruction file port. */
function asInstructionFiles(fs: { exists?(path: string): boolean; readFile(path: string): string }): InstructionFileAccess | null {
  if (typeof fs.readFile !== "function") return null;
  return {
    exists: (path: string) => (typeof fs.exists === "function" ? fs.exists(path) : false),
    readFile: (path: string) => fs.readFile(path),
  };
}

/**
 * Renders workspace instruction layers for the system prompt.
 * Empty string when the filesystem is unusable or no instruction file exists
 * (missing files are the quiet default, unreadable files skip loudly-counted).
 */
export function renderWorkspaceInstructions(fs: unknown): string {
  const files = asInstructionFiles(fs as { exists?(path: string): boolean; readFile(path: string): string });
  if (files === null) return "";
  try {
    const { layers } = loadInstructionLayers(files, {
      bundled: false,
      workspaceFiles: [...WORKSPACE_INSTRUCTION_FILES],
    });
    if (layers.length === 0) return "";
    const rendered = renderInstructions(layers, INSTRUCTIONS_BUDGET_CHARS);
    return rendered.text.trim();
  } catch {
    return "";
  }
}

/** Creates a held instruction state for digest-skipped re-renders (one per workspace). */
export function createInstructionState(): InstructionState {
  return new InstructionState();
}

/**
 * Stateful render: refreshes the held state and skips text rebuild when the
 * digest is unchanged. Returns the rendered text plus change metadata so hosts
 * can avoid re-assembling the system prompt on quiet turns.
 */
export function renderWorkspaceInstructionsWithState(
  fs: unknown,
  state: InstructionState,
  budgetChars: number = INSTRUCTIONS_BUDGET_CHARS,
): { text: string; changed: boolean; digest: string } {
  const files = asInstructionFiles(fs as { exists?(path: string): boolean; readFile(path: string): string });
  if (files === null) return { text: "", changed: false, digest: state.current()?.digest ?? "" };
  try {
    const { snapshot, changed } = state.refresh(files, {
      workspaceFiles: [...WORKSPACE_INSTRUCTION_FILES],
      budget: budgetChars,
    });
    if (snapshot.layers.length === 0) return { text: "", changed, digest: snapshot.digest };
    return { text: snapshot.rendered.text.trim(), changed, digest: snapshot.digest };
  } catch {
    return { text: "", changed: false, digest: state.current()?.digest ?? "" };
  }
}
