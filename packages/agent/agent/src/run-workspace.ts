/**
 * @file run-workspace
 * @description Run-level workspace naming, creation, and follow-up reuse.
 *
 * Responsibilities:
 * - Sanitize client-supplied workspace names into one path-safe segment
 * - Create an isolated workspace per run and write the task README
 * - Reuse a still-resident workspace for follow-up turns without rewriting files
 *
 * label/question are arena run-domain concepts, so this lives in the agent
 * layer; runtime only provides generic WorkspaceRegistry/Workspace primitives.
 */

import type { Clock, IdGenerator } from "@agentprism/contracts";
import { isSafeWorkspaceSegment } from "@agentprism/contracts";
import { RandomIdGenerator, SystemClock, WorkspaceRegistry, type Workspace } from "@agentprism/runtime";

const DEFAULT_CLOCK: Clock = new SystemClock();
const DEFAULT_ID_GEN: IdGenerator = new RandomIdGenerator();

/** Opaque run id from IdGenerator (12-char hex with the default RandomIdGenerator). */
function newRunId(idGen: IdGenerator = DEFAULT_ID_GEN): string {
  return idGen.next();
}

/**
 * Column workspace name: {label}_{ms timestamp}_{6 random chars}.
 * The label is sanitized into a single path-safe segment (letters/digits/dot/
 * underscore/hyphen) so a display label spliced into a disk path cannot escape
 * the directory.
 * Length budget: at most 64 (label) + 1 + 13 (ms epoch) + 1 + 6 (random) = 85 chars,
 * inside the 96-char ceiling enforced by the contracts workspace-name single source
 * (see isReusableWorkspaceName below); changing either bound must keep this inequality,
 * or fresh names stop being reusable.
 */
export function newWorkspaceName(label: string, clock: Clock = DEFAULT_CLOCK, idGen: IdGenerator = DEFAULT_ID_GEN): string {
  const sanitized = label
    .replaceAll(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^[._\s]+/, "")
    .replace(/[.\s]+$/, "")
    .slice(0, 64)
    // The truncation point may land on a ".": clean the tail again so Windows stripping trailing dots never drifts the registered name from the disk directory.
    .replace(/[.\s]+$/, "");
  const safe = sanitized === "" ? "workspace" : sanitized;
  return `${safe}_${clock.now()}_${idGen.next().slice(0, 6)}`;
}

export interface CreatedRunWorkspace {
  workspace: Workspace;
  name: string;
  runId: string;
  /** True when an existing disk workspace was reused for a follow-up turn. */
  reused: boolean;
}

/**
 * Client-supplied workspace names must be a single path-safe segment matching
 * `newWorkspaceName` output. Returns false for unsafe names; the caller creates a
 * new workspace on false/miss. Delegates to the contracts single source shared with
 * the runtime rehydration guard (additionally rejects a bare "."), so the two never drift.
 */
export function isReusableWorkspaceName(name: string): boolean {
  return isSafeWorkspaceSegment(name);
}

/** Creates an isolated workspace for one column run and writes a task README; rolls back the protection mark on failure. */
export function createRunWorkspace(
  manager: WorkspaceRegistry,
  options: { question: string; label: string; runId?: string; clock?: Clock; idGenerator?: IdGenerator },
): CreatedRunWorkspace {
  const runId = options.runId || newRunId(options.idGenerator);
  const name = newWorkspaceName(options.label, options.clock, options.idGenerator);
  manager.protect(name);
  try {
    const workspace = manager.create(name, runId);
    // Labels are unconstrained display text (contracts label is a plain string): fold line
    // breaks so a crafted label cannot escape the markdown heading into the task body.
    const heading = options.label.replace(/[\r\n]+/g, " ");
    workspace.fs.writeFile("README.md", `# ${heading}\n\nTask: ${options.question}\n`);
    return { workspace, name, runId, reused: false };
  } catch (error) {
    manager.unprotect(name);
    throw error;
  }
}

/**
 * Reuses a still-resident column workspace across follow-up turns, or creates a
 * new one. Does not rewrite README on reuse so files the agent already wrote stay intact.
 */
export function resolveRunWorkspace(
  manager: WorkspaceRegistry,
  options: {
    question: string;
    label: string;
    runId?: string;
    clock?: Clock;
    idGenerator?: IdGenerator;
    existingName?: string;
  },
): CreatedRunWorkspace {
  const existingName = options.existingName?.trim() ?? "";
  if (existingName !== "" && isReusableWorkspaceName(existingName)) {
    const existing = manager.get(existingName);
    if (existing !== undefined) {
      manager.protect(existingName);
      return {
        workspace: existing,
        name: existingName,
        runId: options.runId || newRunId(options.idGenerator),
        reused: true,
      };
    }
  }
  return createRunWorkspace(manager, options);
}
