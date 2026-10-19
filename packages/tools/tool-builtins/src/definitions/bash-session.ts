/**
 * @file tools/bash-session
 * @description Builtin bash_session tool: one persistent shell per workspace.
 *
 * Responsibilities:
 * - Start a POSIX bash that outlives single calls (cd/export persist)
 * - Send commands framed by exit-code sentinels; report output plus status
 * - Honor the caller's abort signal mid-send (throws AbortError; shell survives)
 * - Close the shell on demand
 *
 * Persistent shell: every `bash` call starts fresh, so `cd`
 * and `export` never stick — this shell keeps them. Framing is sentinel lines
 * (`__AP_DONE_<seq>__:<exit>`); a send that times out leaves the shell alive
 * and may bleed into the next read (documented, close+reopen resets clean).
 * Concurrent sends on one workspace root queue per shell (the shell executes
 * stdin in order; interleaved polling would misattribute output regions).
 * POSIX only: interactive PowerShell framing is a separate backend, so Windows
 * fails closed toward bash/run_job. Process-scoped like run_job (restart orphans).
 */

import { onWorkspaceDispose } from "./process-scopes.js";
import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";
import { WorkspaceError, spawnPersistentShell, type PersistentShell } from "@agentprism/environment";
import { toolTuningValue } from "../tuning.js";
import { readInt } from "./caps.js";
import { boundText } from "./spill.js";
import { asWorkspaceView } from "./workspace-view.js";

export const BASH_SESSION_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    action: { type: "string", description: "start the shell, send a command, or close it" },
    command: { type: "string", description: "Shell command for send" },
    timeout: { type: "integer", description: "Send wait budget in seconds, 1-120 (default 30)" },
  },
  required: ["action"],
  additionalProperties: false,
};

const ACTIONS = ["start", "send", "close"] as const;
const POLL_MS = 20;

interface ShellRecord {
  shell: PersistentShell;
  /**
   * Absolute output offset already reported (shell.outputStart() rebases it onto
   * the current buffer, whose head the cap may have trimmed).
   */
  cursor: number;
  seq: number;
  /**
   * Settled tail of this record's send queue: concurrent sends on one workspace
   * serialize instead of interleaving their polling windows (see enqueueSend).
   */
  sendTail: Promise<unknown>;
}

/** Process-scoped shells namespaced by workspace root (see file header for lifetime limits). */
const SHELLS = new Map<string, ShellRecord>();

// Workspace release kills the resident shell; otherwise it outlives its workspace.
onWorkspaceDispose((root) => {
  const record = SHELLS.get(root);
  if (record === undefined) return;
  record.shell.kill();
  SHELLS.delete(root);
});

function markerFor(seq: number): string {
  return `__AP_DONE_${seq}__`;
}

/**
 * Runs one send through the record's send queue and returns its result.
 *
 * The shell executes stdin in arrival order, so overlapping sends share one
 * output stream; without the queue their polling windows interleave on the same
 * cursor and the send whose sentinel lands second can consume the first send's
 * whole output region (marker line included), stranding it into a false timeout.
 * Queueing matches the shell's own ordering. Each queued send re-validates the
 * record because close/start may have replaced or removed it while the caller
 * waited.
 */
function enqueueSend(
  workspace: ToolWorkspace,
  root: string,
  record: ShellRecord,
  command: string,
  timeoutSeconds: number,
  signal: AbortSignal | undefined,
): Promise<ToolExecutionResult> {
  const task = (): Promise<ToolExecutionResult> =>
    pollUntilSentinel(workspace, root, record, command, timeoutSeconds, signal);
  const gate = record.sendTail.then(task, task);
  // The stored tail swallows rejections so one aborted send never poisons the next.
  record.sendTail = gate.catch(() => undefined);
  return gate;
}

/** Writes one framed command and polls for its sentinel (runs under the send queue). */
async function pollUntilSentinel(
  workspace: ToolWorkspace,
  root: string,
  record: ShellRecord,
  command: string,
  timeoutSeconds: number,
  signal: AbortSignal | undefined,
): Promise<ToolExecutionResult> {
  if (signal?.aborted) {
    // Abort parity with the bash tool: a pre-aborted call must not write a
    // doomed command into the resident shell. The registry rethrows AbortError.
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    throw abortError;
  }
  // A queued send may face a shell that was closed and restarted while it waited;
  // the stale record's stream no longer belongs to this caller.
  if (SHELLS.get(root) !== record) {
    return { result: "Error: no live shell (start one first)", fileDiff: null, ok: false, code: "workspace_error" };
  }
  record.seq += 1;
  const marker = markerFor(record.seq);
  record.shell.write(`${command}\necho ${marker}:$?\n`);
  const deadline = Date.now() + timeoutSeconds * 1000;
  let output = "";
  // Buffer coordinates of the freshest read window: base is the buffer's absolute
  // stream offset (outputStart) and from is the cursor's buffer-local index. The
  // cap head-trims the buffer as output floods, so the cursor is rebased each poll.
  let base = 0;
  let from = 0;
  let markerAt = -1;
  let code: string | null = null;
  while (Date.now() < deadline) {
    base = record.shell.outputStart();
    output = record.shell.output();
    from = Math.max(0, record.cursor - base);
    const fresh = output.slice(from);
    const at = fresh.indexOf(`${marker}:`);
    if (at >= 0) {
      const tail = fresh.slice(at + marker.length + 1);
      const match = tail.match(/^(\d+)/);
      if (match !== null) {
        markerAt = from + at;
        code = match[1] as string;
        break;
      }
    }
    if (!record.shell.alive()) break;
    if (signal?.aborted) {
      // Abort parity with the bash tool: a cancelled run must stop polling for
      // the sentinel instead of burning the full deadline in 20ms sleeps (the
      // registry rethrows AbortError to the driver, converging the run). The
      // shell stays alive and its output cursor is untouched — close/start
      // resets clean, per the documented bleed-through semantics.
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      throw abortError;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  if (markerAt < 0 && !record.shell.alive()) {
    // Remove only our own record: a close+start during this send installs a
    // fresh shell whose record must survive this stale send's cleanup.
    if (SHELLS.get(root) === record) SHELLS.delete(root);
    return {
      result: boundText(
        workspace,
        "bash_session",
        `Shell exited while the command ran; partial output:
${output.slice(from)}`,
      ),
      fileDiff: null,
      ok: true,
    };
  }
  if (markerAt < 0) {
    return {
      result: boundText(
        workspace,
        "bash_session",
        `Still running after ${timeoutSeconds}s (shell stays alive): output so far:\n${output.slice(from)}\n` +
          "A later send may include this bleed-through; close+start resets clean.",
      ),
      fileDiff: null,
      ok: true,
    };
  }
  const body = output.slice(from, markerAt).trimEnd();
  const afterMarker = markerAt + marker.length + 1 + (code?.length ?? 0);
  // The cursor is absolute: it survives later head trims via outputStart().
  record.cursor = base + afterMarker;
  // Skip the marker line's trailing newline so the next read starts clean.
  if (output.slice(afterMarker).startsWith("\n")) record.cursor += 1;
  const shown = body === "" ? "(no output)" : body;
  return { result: boundText(workspace, "bash_session", `${shown}\n[exit ${code}]`), fileDiff: null, ok: true };
}

async function executeBashSession(workspace: ToolWorkspace, args: ToolArgs, signal?: AbortSignal): Promise<ToolExecutionResult> {
  try {
    const view = asWorkspaceView(workspace);
    // Action names are case-tolerant so a cased call still binds instead of error-looping.
    const action = String(args.action ?? "").trim().toLowerCase();
    if (!(ACTIONS as readonly string[]).includes(action)) {
      return { result: `Error: action must be one of ${ACTIONS.join(", ")}`, fileDiff: null, ok: false, code: "workspace_error" };
    }
    if (action === "start") {
      // The persistent shell has no sandbox enforcement path (same-user pipes,
      // no per-command spawn): with the OS sandbox requested, starting an
      // unrestricted shell would quietly bypass the containment that bash/run_job
      // honor. Fail closed regardless of platform.
      if (workspace.sandbox !== undefined) {
        return {
          result: "Error: sandbox_mode=os is enabled but bash_session cannot enforce the OS write sandbox; use bash/run_job (sandboxed) or disable sandbox_mode for shell sessions",
          fileDiff: null,
          ok: false,
          code: "workspace_error",
        };
      }
      const existing = SHELLS.get(view.root);
      if (existing !== undefined && existing.shell.alive()) {
        return { result: "Shell already running: use send (cd/export persist), close to reset", fileDiff: null, ok: true };
      }
      if (existing !== undefined) SHELLS.delete(view.root);
      const shell = spawnPersistentShell({ cwd: view.cwd() });
      SHELLS.set(view.root, { shell, cursor: 0, seq: 0, sendTail: Promise.resolve() });
      return { result: `Shell started (pid ${shell.pid ?? "unknown"}): send commands, close when done`, fileDiff: null, ok: true };
    }
    const record = SHELLS.get(view.root);
    if (record === undefined || !record.shell.alive()) {
      if (record !== undefined) SHELLS.delete(view.root);
      return { result: "Error: no live shell (start one first)", fileDiff: null, ok: false, code: "workspace_error" };
    }
    if (action === "close") {
      record.shell.kill();
      SHELLS.delete(view.root);
      return { result: "Shell closed", fileDiff: null, ok: true };
    }
    const command = String(args.command ?? "").trim();
    if (command === "") {
      return { result: "Error: command must not be empty", fileDiff: null, ok: false, code: "workspace_error" };
    }
    const timeoutSeconds = Math.min(
      Math.max(readInt(args, "timeout", toolTuningValue("runTimeoutDefaultS", 30)), 1),
      toolTuningValue("runTimeoutMaxS", 120),
    );
    return enqueueSend(workspace, view.root, record, command, timeoutSeconds, signal);
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return { result: error.message, fileDiff: null, ok: false, code: "workspace_error" };
    }
    throw error;
  }
}

/** Builtin bash_session tool definition. */
export const bashSessionTool: ToolDefinition = {
  name: "bash_session",
  description:
    "One persistent POSIX shell per workspace (cd/export survive across sends). start, then send commands (framed output plus exit code), close to reset. Process-scoped; Windows fails closed toward bash/run_job.",
  jsonSchema: BASH_SESSION_JSON_SCHEMA,
  mutatesWorkspace: true,
  execute: executeBashSession,
};
