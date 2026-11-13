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

/** Workspace files consulted for instruction layers (precedence low to high). */
const WORKSPACE_INSTRUCTION_FILES = ["AGENTS.md", "AGENTS.local.md"] as const;

/** Rendered instruction budget in chars (matches the library default). */
const INSTRUCTIONS_BUDGET_CHARS = 6000;

/**
 * Byte cap for one instruction-file read. A full read would materialize arbitrary
 * workspace content — the agent's own tools can write these files — on every prompt
 * assembly. Files under the cap are read exactly as before; over the cap the read
 * stops at 64 KiB, and the renderer may keep a head+tail of that READ WINDOW, so the
 * adapter appends a truncation note: without it the retained tail would masquerade
 * as the file's real end.
 */
const INSTRUCTION_FILE_READ_BYTES = 64 * 1024;

/** Appended to a truncated instruction-file read so the retained tail is not mistaken for the file end. */
const INSTRUCTION_FILE_TRUNCATION_NOTE =
  `\n\n…[instruction file truncated: only the first ${INSTRUCTION_FILE_READ_BYTES / 1024} KiB were read]…`;

/** Structural workspace fs surface; readFileHead is the environment layer's bounded read. */
interface WorkspaceInstructionFs {
  exists?(path: string): boolean;
  readFile(path: string): string;
  readFileHead?(path: string, maxBytes: number, startByte?: number): { text: string; truncated?: boolean };
}

/** Adapts a structural workspace fs to the instruction file port (null when unusable). */
function asInstructionFiles(fs: unknown): InstructionFileAccess | null {
  if (fs === null || typeof fs !== "object") return null;
  const candidate = fs as WorkspaceInstructionFs;
  if (typeof candidate.readFile !== "function") return null;
  return {
    exists: (path: string) => (typeof candidate.exists === "function" ? candidate.exists(path) : false),
    readFile: (path: string) => {
      if (typeof candidate.readFileHead !== "function") return candidate.readFile(path);
      const head = candidate.readFileHead(path, INSTRUCTION_FILE_READ_BYTES);
      return head.truncated === true ? head.text + INSTRUCTION_FILE_TRUNCATION_NOTE : head.text;
    },
  };
}

/**
 * Renders workspace instruction layers for the system prompt.
 * Empty string when the filesystem is unusable or no instruction file exists
 * (missing files are the quiet default; unreadable files are counted by the
 * library and an unexpected failure degrades to no block with a warning).
 */
export function renderWorkspaceInstructions(fs: unknown): string {
  const files = asInstructionFiles(fs);
  if (files === null) return "";
  try {
    const { layers } = loadInstructionLayers(files, {
      bundled: false,
      workspaceFiles: [...WORKSPACE_INSTRUCTION_FILES],
    });
    if (layers.length === 0) return "";
    const rendered = renderInstructions(layers, INSTRUCTIONS_BUDGET_CHARS);
    return rendered.text.trim();
  } catch (error) {
    // Degrade to no instruction block, but leave a trace: a silently dropped
    // block changes the system prompt without any evidence in the run.
    console.warn(
      `[harness] Workspace instructions unavailable (block skipped): ${error instanceof Error ? error.message : String(error)}`,
    );
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
  const files = asInstructionFiles(fs);
  if (files === null) return { text: "", changed: false, digest: state.current()?.digest ?? "" };
  try {
    const { snapshot, changed } = state.refresh(files, {
      workspaceFiles: [...WORKSPACE_INSTRUCTION_FILES],
      budget: budgetChars,
    });
    if (snapshot.layers.length === 0) return { text: "", changed, digest: snapshot.digest };
    return { text: snapshot.rendered.text.trim(), changed, digest: snapshot.digest };
  } catch (error) {
    console.warn(
      `[harness] Workspace instruction refresh failed (held state kept): ${error instanceof Error ? error.message : String(error)}`,
    );
    return { text: "", changed: false, digest: state.current()?.digest ?? "" };
  }
}
