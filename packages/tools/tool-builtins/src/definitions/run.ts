/**
 * @file tools/run
 * @description Builtin run tool: command lines (no shell on POSIX; spawns argv directly) inside the workspace cwd.
 *
 * Responsibilities:
 * - Declare the tool's JSON schema
 * - Execute commands with the workspace as working directory
 *
 * Windows routes through PowerShell 5.1 (always present on the OS) so commands
 * like Get-ChildItem, git, npm, and test runners share one interpreter; POSIX
 * spawns the parsed argv directly.
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";
import { WorkspaceError, runProcess, splitShellCommand } from "@agentprism/environment";
import { toolTuningValue } from "../tuning.js";
import { readInt } from "./caps.js";
import { boundText } from "./spill.js";
import { asWorkspaceView } from "./workspace-view.js";

export const RUN_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    command: { type: "string" },
    timeout: { type: "integer" },
  },
  required: ["command"],
  additionalProperties: false,
};

/** Windows command interpreter: PowerShell 5.1 ships with every supported Windows version. */
const WIN32_SHELL = "powershell.exe";
const WIN32_SHELL_ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];
/**
 * Forces UTF-8 output on Chinese Windows: PowerShell 5.1 otherwise emits GBK,
 * which Node decodes as mojibake (U+FFFD runs in Chinese error text).
 * No-BOM: a BOM would leak into captured stdout. Python/Node already emit
 * UTF-8 here (PYTHONIOENCODING is pinned, Node defaults to UTF-8 on pipes).
 */
const WIN32_UTF8_PREAMBLE = "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); ";

async function executeRun(
  workspace: ToolWorkspace,
  args: ToolArgs,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  if (signal?.aborted) {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    throw abortError;
  }
  try {
    const view = asWorkspaceView(workspace);
    const command = String(args.command ?? "").trim();
    const timeoutSeconds = Math.min(
      Math.max(readInt(args, "timeout", toolTuningValue("runTimeoutDefaultS", 30)), 1),
      toolTuningValue("runTimeoutMaxS", 120),
    );
    if (command === "") {
      return { result: "Error: command must not be empty", fileDiff: null, ok: false, code: "workspace_error" };
    }
    let argv: string[];
    if (process.platform === "win32") {
      argv = [WIN32_SHELL, ...WIN32_SHELL_ARGS, WIN32_UTF8_PREAMBLE + command];
    } else {
      argv = splitShellCommand(command, true);
    }
    if (argv.length === 0) {
      return { result: "Error: command must not be empty", fileDiff: null, ok: false, code: "workspace_error" };
    }
    const finished = await runProcess({
      argv,
      cwd: view.cwd(),
      timeoutSeconds,
      signal,
      // Sandbox hint arrives via the workspace (agent-level sandbox_mode); an absent
      // hint means the spawn runs unsandboxed.
      sandbox: workspace.sandbox,
    });
    if (finished.kind === "aborted") {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      throw abortError;
    }
    if (finished.kind === "timeout") {
      return { result: `Error: command timed out (${timeoutSeconds}s)`, fileDiff: null, ok: false, code: "workspace_error" };
    }
    if (finished.kind === "error") {
      return { result: `Error: ${finished.errorMessage ?? finished.errorName ?? "Error"}`, fileDiff: null, ok: false, code: "workspace_error" };
    }
    let out = finished.stdout + finished.stderr;
    if (finished.exitCode !== 0) {
      out = `[exit ${finished.exitCode}]\n${out}`;
    }
    return { result: boundText(workspace, "run", out), fileDiff: null, ok: true };
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    if (error instanceof WorkspaceError) {
      return { result: error.message, fileDiff: null, ok: false, code: "workspace_error" };
    }
    throw error;
  }
}

/** Builtin run tool definition. */
export const runTool: ToolDefinition = {
  name: "run",
  description:
    "Run a shell command in the workspace cwd (PowerShell on Windows, e.g. python snake.py, git status, npm test). Separate statements with `;` (PowerShell 5.1 has no `&&`/`||` chains).",
  jsonSchema: RUN_JSON_SCHEMA,
  mutatesWorkspace: true,
  execute: executeRun,
};
