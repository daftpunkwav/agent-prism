/**
 * @file tools/bash-session
 * @description Builtin bash_session tool: one persistent shell per workspace.
 *
 * Responsibilities:
 * - Start a POSIX bash that outlives single calls (cd/export persist)
 * - Send commands framed by exit-code sentinels; report output plus status
 * - Close the shell on demand
 *
 * Persistent shell: every `run` call starts fresh, so `cd`
 * and `export` never stick — this shell keeps them. Framing is sentinel lines
 * (`__AP_DONE_<seq>__:<exit>`); a send that times out leaves the shell alive
 * and may bleed into the next read (documented, close+reopen resets clean).
 * POSIX only: interactive PowerShell framing is a separate backend, so Windows
 * fails closed toward run/run_job. Process-scoped like run_job (restart orphans).
 */

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
  /** Output offset already reported: each send reads from here to its sentinel. */
  cursor: number;
  seq: number;
}

/** Process-scoped shells namespaced by workspace root (see file header for lifetime limits). */
const SHELLS = new Map<string, ShellRecord>();

function markerFor(seq: number): string {
  return `__AP_DONE_${seq}__`;
}

async function executeBashSession(workspace: ToolWorkspace, args: ToolArgs): Promise<ToolExecutionResult> {
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
      // unrestricted shell would quietly bypass the containment that run/run_job
      // honor. Fail closed regardless of platform.
      if (workspace.sandbox !== undefined) {
        return {
          result: "Error: sandbox_mode=os is enabled but bash_session cannot enforce the OS write sandbox; use run/run_job (sandboxed) or disable sandbox_mode for shell sessions",
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
      SHELLS.set(view.root, { shell, cursor: 0, seq: 0 });
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
    record.seq += 1;
    const marker = markerFor(record.seq);
    record.shell.write(`${command}\necho ${marker}:$?\n`);
    const deadline = Date.now() + timeoutSeconds * 1000;
    let output = "";
    let foundAt = -1;
    let code: string | null = null;
    while (Date.now() < deadline) {
      output = record.shell.output();
      const fresh = output.slice(record.cursor);
      const at = fresh.indexOf(`${marker}:`);
      if (at >= 0) {
        const tail = fresh.slice(at + marker.length + 1);
        const match = tail.match(/^(\d+)/);
        if (match !== null) {
          foundAt = record.cursor + at;
          code = match[1] as string;
          break;
        }
      }
      if (!record.shell.alive()) break;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    if (foundAt < 0 && !record.shell.alive()) {
      SHELLS.delete(view.root);
      return {
        result: boundText(
          workspace,
          "bash_session",
          `Shell exited while the command ran; partial output:
${output.slice(record.cursor)}`,
        ),
        fileDiff: null,
        ok: true,
      };
    }
    if (foundAt < 0) {
      return {
        result: boundText(
          workspace,
          "bash_session",
          `Still running after ${timeoutSeconds}s (shell stays alive): output so far:\n${output.slice(record.cursor)}\n` +
            "A later send may include this bleed-through; close+start resets clean.",
        ),
        fileDiff: null,
        ok: true,
      };
    }
    const body = output.slice(record.cursor, foundAt).trimEnd();
    record.cursor = foundAt + marker.length + 1 + (code?.length ?? 0);
    // Skip the marker line's trailing newline so the next read starts clean.
    const rest = output.slice(record.cursor);
    record.cursor += rest.startsWith("\n") ? 1 : 0;
    const shown = body === "" ? "(no output)" : body;
    return { result: boundText(workspace, "bash_session", `${shown}\n[exit ${code}]`), fileDiff: null, ok: true };
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
    "One persistent POSIX shell per workspace (cd/export survive across sends). start, then send commands (framed output plus exit code), close to reset. Process-scoped; Windows fails closed toward run/run_job.",
  jsonSchema: BASH_SESSION_JSON_SCHEMA,
  mutatesWorkspace: true,
  execute: executeBashSession,
};
