/**
 * @file tools/run-job
 * @description Builtin run_job tool: background shell commands with poll/kill.
 *
 * Responsibilities:
 * - Start background commands inside the workspace cwd (same interpreter as run)
 * - Poll incremental output per job (delta since last poll, context-efficient)
 * - Spill oversized unspilled output to .spills/ files (rotated) instead of losing the middle
 * - Kill jobs and list live records
 *
 * Background job handles: the foreground `run` caps at 120s,
 * so servers, watchers, and sleepers had no honest home (models faked them with
 * `sleep &&` chains). Jobs are process-scoped: a server restart orphans the OS
 * process (documented, not silently solved). Starts pass through the same
 * sandbox deny-list as run (see sandbox toBeforeExecute).
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";
import { WorkspaceError, spawnBackground, splitShellCommand, type BackgroundJob } from "@agentprism/environment";
import { truncate } from "./caps.js";
import { asWorkspaceView } from "./workspace-view.js";

export const RUN_JOB_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    action: { type: "string", description: "start a command, poll output, kill the job, or list jobs" },
    command: { type: "string", description: "Shell command for start (same syntax as run)" },
    job_id: { type: "string", description: "Job id for poll/kill" },
  },
  required: ["action"],
  additionalProperties: false,
};

/** Windows command interpreter (mirrors the run tool: PowerShell 5.1 is always present). */
const WIN32_SHELL = "powershell.exe";
const WIN32_SHELL_ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];
/** Same UTF-8 forcing as the run tool: without it Chinese Windows output arrives as GBK mojibake. */
const WIN32_UTF8_PREAMBLE = "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); ";

/** Per-workspace live-job ceiling: the registry stays small and reaps exited jobs on start. */
const MAX_JOBS_PER_WORKSPACE = 8;

const ACTIONS = ["start", "poll", "kill", "list"] as const;
type JobAction = (typeof ACTIONS)[number];

interface JobRecord {
  id: string;
  command: string;
  job: BackgroundJob;
  /** Output chars already reported: polls return the delta, not the whole log. */
  sent: number;
  killed: boolean;
  /** Output chars already persisted to spill files (monotone; bounds disk writes). */
  spilled: number;
}

/** Oversized poll deltas spill to workspace files instead of vanishing. */
const SPILL_DIR = ".spills";
const SPILL_THRESHOLD_CHARS = 32 * 1024;
const MAX_SPILL_BYTES = 256 * 1024;
const MAX_SPILL_FILES = 20;

/** Process-scoped registry namespaced by workspace root (see file header for lifetime limits). */
interface JobScope {
  seq: number;
  records: Map<string, JobRecord>;
  /** Workspace-wide spill sequence: filenames sort chronologically so rotation evicts oldest first. */
  spills: number;
}

const JOBS = new Map<string, JobScope>();

function scopeFor(root: string): JobScope {
  let scope = JOBS.get(root);
  if (scope === undefined) {
    scope = { seq: 0, records: new Map(), spills: 0 };
    JOBS.set(root, scope);
  }
  return scope;
}

function reapExited(scope: { records: Map<string, JobRecord> }): void {
  for (const [id, record] of scope.records) {
    if (!record.job.alive()) scope.records.delete(id);
  }
}

function buildArgv(command: string): string[] {
  if (process.platform === "win32") return [WIN32_SHELL, ...WIN32_SHELL_ARGS, WIN32_UTF8_PREAMBLE + command];
  return splitShellCommand(command, true);
}

function statusLine(record: JobRecord): string {
  const code = record.job.exitCode();
  if (record.job.alive()) return "running";
  if (code === null) return record.killed ? "killed" : "finished (exit code pending)";
  return `exited (${code})`;
}

/**
 * Renders one poll: status head plus the delta since the last poll.
 *
 * Oversized unspilled volume spills to timestamped .spills/ files (rotated) so the
 * middle survives; failures degrade to a loud note, never silent truncation.
 *
 * @param record Live job record (sent/spilled offsets advance as a side effect).
 * @param scope Workspace job scope (spill sequence for chronological filenames).
 * @param fs Workspace filesystem for spill writes and rotation.
 * @returns Head line plus delta text with an optional spill/failure note.
 */
function renderPoll(
  record: JobRecord,
  scope: JobScope,
  fs: { writeFile(path: string, content: string): unknown; deleteFile(path: string): unknown; listFiles(dir: string, options?: { recursive?: boolean }): string[] },
): string {
  const full = record.job.output();
  const delta = full.slice(record.sent);
  record.sent = full.length;
  const head = `job ${record.id}: ${statusLine(record)}, ${full.length} chars total`;
  // Sandbox setup failure: the exit-3 sentinel is mapped to a readable note
  // instead of drowning in raw output, mirroring the run tool.
  const setupFailure = record.job.sandboxSetupFailure();
  const setupNote =
    setupFailure === null || record.job.alive()
      ? ""
      : `\n(${setupFailure}; the job never started — check sandbox_mode or the workspace root)`;
  if (delta === "" && setupNote === "") return `${head}\n(no new output)`;
  if (delta === "") return `${head}${setupNote}`;
  // Spill trigger keys on unspilled volume, not the single delta: streamed output
  // arrives in arbitrary chunks, so per-delta thresholds would rarely fire while the
  // middle still vanishes. Spilled files stay readable/greppable mid-run.
  const unspilled = full.slice(record.spilled);
  let spillNote = "";
  if (unspilled.length > SPILL_THRESHOLD_CHARS) {
    // The middle would otherwise vanish: persist the full span for read/grep,
    // rotate oldest spill files first, and degrade loudly (never silently).
    try {
      scope.spills += 1;
      const file = `${SPILL_DIR}/${String(scope.spills).padStart(6, "0")}-${record.id}.log`;
      const body =
        unspilled.length > MAX_SPILL_BYTES
          ? `${unspilled.slice(0, MAX_SPILL_BYTES)}\n…(spill capped, ${unspilled.length} chars total)`
          : unspilled;
      fs.writeFile(file, body);
      record.spilled = full.length;
      const spilled = fs
        .listFiles(SPILL_DIR, { recursive: false })
        .filter((entry) => entry.endsWith(".log"))
        .sort();
      for (const extra of spilled.slice(0, Math.max(0, spilled.length - MAX_SPILL_FILES))) {
        try {
          fs.deleteFile(extra);
        } catch {
          // Rotation is hygiene, not correctness: a stuck file costs disk, not truth.
        }
      }
      spillNote = `\n(${unspilled.length} chars spilled to ${file}; read/grep it for the middle)`;
    } catch (error) {
      spillNote = `\n(spill failed: ${error instanceof Error ? error.message : String(error)})`;
    }
  }
  return `${head}\n${truncate(delta)}${spillNote}${setupNote}`;
}

async function executeRunJob(workspace: ToolWorkspace, args: ToolArgs): Promise<ToolExecutionResult> {
  try {
    const view = asWorkspaceView(workspace);
    // Action names are case-tolerant so a cased call still binds instead of error-looping.
    const action = String(args.action ?? "").trim().toLowerCase();
    if (!(ACTIONS as readonly string[]).includes(action)) {
      return { result: `Error: action must be one of ${ACTIONS.join(", ")}`, fileDiff: null, ok: false, code: "workspace_error" };
    }
    const scope = scopeFor(view.root);
    if (action === "list") {
      if (scope.records.size === 0) return { result: "(no background jobs)", fileDiff: null, ok: true };
      const lines = [...scope.records.values()].map((record) => `${record.id}: ${statusLine(record)} — ${record.command}`);
      return { result: truncate(lines.join("\n")), fileDiff: null, ok: true };
    }
    if (action === "start") {
      const command = String(args.command ?? "").trim();
      if (command === "") {
        return { result: "Error: command must not be empty", fileDiff: null, ok: false, code: "workspace_error" };
      }
      const argv = buildArgv(command);
      if (argv.length === 0) {
        return { result: "Error: command must not be empty", fileDiff: null, ok: false, code: "workspace_error" };
      }
      reapExited(scope);
      if (scope.records.size >= MAX_JOBS_PER_WORKSPACE) {
        return {
          result: `Error: ${MAX_JOBS_PER_WORKSPACE} live jobs already; poll/kill one first (list to see them)`,
          fileDiff: null,
          ok: false,
          code: "workspace_error",
        };
      }
      const job = spawnBackground({ argv, cwd: view.cwd(), sandbox: workspace.sandbox });
      scope.seq += 1;
      const id = `job-${scope.seq}`;
      scope.records.set(id, { id, command, job, sent: 0, killed: false, spilled: 0 });
      return { result: `started ${id} (pid ${job.pid ?? "unknown"}): poll for output, kill to stop`, fileDiff: null, ok: true };
    }
    const jobId = String(args.job_id ?? "").trim();
    const record = scope.records.get(jobId);
    if (record === undefined) {
      return { result: `Error: unknown job ${jobId === "" ? "(empty id)" : jobId} (list to see live jobs)`, fileDiff: null, ok: false, code: "workspace_error" };
    }
    if ((action as JobAction) === "poll") {
      return { result: renderPoll(record, scope, view.fs), fileDiff: null, ok: true };
    }
    record.killed = true;
    record.job.kill();
    return { result: `kill sent to ${record.id}: ${statusLine(record)}`, fileDiff: null, ok: true };
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return { result: error.message, fileDiff: null, ok: false, code: "workspace_error" };
    }
    throw error;
  }
}

/** Builtin run_job tool definition. */
export const runJobTool: ToolDefinition = {
  name: "run_job",
  description:
    "Background shell commands in the workspace cwd (same syntax as run): start returns a job id, poll shows output since the last poll (oversized output spills to .spills/ files), kill stops it, list shows live jobs. Jobs die with the server (process-scoped); sandbox deny-list applies to starts.",
  jsonSchema: RUN_JOB_JSON_SCHEMA,
  mutatesWorkspace: true,
  execute: executeRunJob,
};
