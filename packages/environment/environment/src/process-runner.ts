/**
 * @file process-runner
 * @description External command execution without a shell.
 *
 * Responsibilities:
 * - Enforce timeouts with escalation and cap captured output
 * - Pass a child-safe env allowlist (childProcessEnv)
 * - Split shell-like command lines without invoking a shell
 * - Route sandboxed spawns through the sandbox transform and map authenticated
 *   setup-failure sentinels to process errors (fail-closed, never silent)
 */

import { spawn, type ChildProcess } from "node:child_process";
import { TextDecoder } from "node:util";
import { WorkspaceError } from "./scoped-filesystem.js";
import {
  createSandboxNonce,
  isSandboxSetupFailure,
  sandboxSetupFailureReason,
  sandboxSpawnTransform,
  type ProcessSandboxRequest,
} from "./sandbox-launcher.js";

/** Settled outcome of one external command run (see runProcess). */
export interface ProcessResult {
  kind: "ok" | "timeout" | "error" | "aborted";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** Exception type name when kind=error (only the type name is exposed externally to prevent leaks). */
  errorName?: string;
  /** Human-readable reason for setup-level failures (sandbox unavailable/refused); never child output. */
  errorMessage?: string;
}

export interface ProcessOptions {
  argv: string[];
  cwd: string;
  /** Seconds; the process is killed after the timeout. */
  timeoutSeconds: number;
  /** Cancellation: aborts the wait and kills the child (resolves kind=aborted, never hangs). */
  signal?: AbortSignal;
  /** When set, the child spawns under the OS write-restricted sandbox (fail-closed where unenforceable). */
  sandbox?: ProcessSandboxRequest;
}

/** Cumulative output cap per stream (characters) to keep huge outputs from exhausting memory. */
const MAX_OUTPUT_CHARS = 1_000_000;

/**
 * Per-stream output decoder: strict UTF-8 first, GBK fallback once the stream
 * proves it is not UTF-8. On Chinese Windows the spawn preamble switches
 * PowerShell to UTF-8, but output that precedes the preamble (parse errors) and
 * native tools that ignore the console codepage still arrive as GBK; decoding
 * those as UTF-8 produced U+FFFD runs. `stream: true` keeps multi-byte
 * characters that straddle chunk boundaries intact, and the fallback is
 * permanent per stream because one stream never mixes encodings in practice.
 */
class StreamDecoder {
  private utf8 = new TextDecoder("utf-8", { fatal: true });
  private gbk: TextDecoder | null = null;

  decode(chunk: Buffer): string {
    if (this.gbk !== null) return this.gbk.decode(chunk, { stream: true });
    try {
      return this.utf8.decode(chunk, { stream: true });
    } catch {
      try {
        this.gbk = new TextDecoder("gbk");
        return this.gbk.decode(chunk, { stream: true });
      } catch {
        // No GBK support in this runtime (ICU-less build): keep lossy UTF-8.
        this.gbk = new TextDecoder();
        return this.gbk.decode(chunk, { stream: true });
      }
    }
  }
}

/** Grace period (ms) between SIGTERM and forced SIGKILL. */
const KILL_ESCALATE_MS = 3_000;

/**
 * Grace period (ms) after the direct child exits for stdio to flush naturally.
 * The close event waits for all stdio streams to close; when grandchildren inherit
 * the pipes (e.g. `cmd &`), close never fires while the timeout kill only reaches the
 * direct child — after the grace period the streams are destroyed to force close.
 */
const POST_EXIT_FLUSH_MS = 100;

/**
 * Child-process env allowlist: only base variables needed for execution are inherited;
 * host secrets such as API keys and proxy credentials are not passed through (the model
 * can read subprocess output via the bash tool).
 */
const ALLOWED_ENV_KEYS: readonly string[] = [
  "PATH",
  "HOME",
  "LANG",
  "TEMP",
  "TMP",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "PROGRAMFILES",
  "PROGRAMW6432",
  "PROGRAMDATA",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "USERNAME",
];

/** Child-process env: allowlist inheritance + pinned encoding + proxy bypass. */
export function childProcessEnv(): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) inherited[key] = value;
  }
  return {
    ...inherited,
    PYTHONIOENCODING: "utf-8",
    NO_PROXY: "*",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
  };
}

/**
 * Runs one external command without a shell and waits for it to settle.
 *
 * @param options argv/cwd/timeoutSeconds plus optional AbortSignal.
 * @returns Settled outcome: ok/timeout/error/aborted with capped stdio and exit code.
 */
export function runProcess(options: ProcessOptions): Promise<ProcessResult> {
  const { argv, cwd, timeoutSeconds, signal, sandbox } = options;
  if (signal?.aborted === true) {
    return Promise.resolve({ kind: "aborted", stdout: "", stderr: "", exitCode: null });
  }
  // Authenticated per-spawn marker so a sandboxed command echoing the sentinel
  // cannot fake a setup failure (only the helper knows the nonce).
  const sandboxNonce = sandbox === undefined ? "" : createSandboxNonce();
  return new Promise((resolve) => {
    let child;
    try {
      const effectiveArgv = sandbox === undefined ? argv : sandboxSpawnTransform()(argv, cwd, sandbox, sandboxNonce);
      child = spawn(effectiveArgv[0] ?? "", effectiveArgv.slice(1), {
        cwd,
        shell: false,
        env: childProcessEnv(),
        windowsHide: true,
      });
    } catch (error) {
      if (error instanceof WorkspaceError) {
        resolve({ kind: "error", stdout: "", stderr: "", exitCode: null, errorMessage: error.message });
        return;
      }
      resolve({ kind: "error", stdout: "", stderr: "", exitCode: null, errorName: (error as Error).name });
      return;
    }
    // Non-interactive child command: close stdin immediately so input-waiting
    // commands hit EOF and exit fast. Outside the spawn try: a failure here must
    // not resolve an error while the child keeps running (orphan).
    try {
      child.stdin?.end();
    } catch (error) {
      child.kill();
      resolve({ kind: "error", stdout: "", stderr: "", exitCode: null, errorName: (error as Error).name });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    // Tracks our own kills so an external signal (OOM killer, admin kill) is never misreported as a timeout.
    let killReason: "timeout" | "abort" | null = null;
    let abortEscalate: NodeJS.Timeout | null = null;
    const clearAbortEscalate = () => {
      if (abortEscalate !== null) {
        clearTimeout(abortEscalate);
        abortEscalate = null;
      }
    };
    const onAbort = () => {
      if (settled || killReason !== null) return;
      // The child already exited (close pending for stdio flush): killing now is a no-op,
      // and claiming "abort" would misreport a finished run — let close() report its real outcome.
      if (child.exitCode !== null || child.signalCode !== null) return;
      killReason = "abort";
      child.kill();
      // Abort-time escalation mirrors the timeout path: a SIGTERM-ignoring child must not
      // hold the abort until the (possibly minutes-long) command timeout expires.
      abortEscalate = setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, KILL_ESCALATE_MS);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    // Cumulative output cap: stop appending once reached (the process keeps running until exit or timeout) so huge output cannot fill memory.
    const stdoutDecoder = new StreamDecoder();
    const stderrDecoder = new StreamDecoder();
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += stdoutDecoder.decode(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += stderrDecoder.decode(chunk);
    });
    const escalate = setTimeout(() => {
      // Still running after SIGTERM (signal ignored / grandchild holds the stdio pipes): force kill so the Promise never hangs forever
      if (!settled) child.kill("SIGKILL");
    }, timeoutSeconds * 1000 + KILL_ESCALATE_MS);
    const timer = setTimeout(() => {
      // First killer wins: an abort already in flight keeps its "aborted" outcome (and its own escalation).
      if (settled || killReason !== null) return;
      killReason = "timeout";
      child.kill();
    }, timeoutSeconds * 1000);
    let flushTimer: NodeJS.Timeout | null = null;
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(escalate);
      clearAbortEscalate();
      if (flushTimer !== null) clearTimeout(flushTimer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ kind: "error", stdout, stderr, exitCode: null, errorName: error.name });
    });
    child.on("exit", () => {
      if (settled) return;
      // Normal path: close arrives after streams drain; the grace timer only destroys streams as a fallback when a grandchild holds the pipes
      flushTimer = setTimeout(() => {
        if (settled) return;
        child.stdout?.destroy();
        child.stderr?.destroy();
      }, POST_EXIT_FLUSH_MS);
    });
    child.on("close", (code, termSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(escalate);
      clearAbortEscalate();
      if (flushTimer !== null) clearTimeout(flushTimer);
      signal?.removeEventListener("abort", onAbort);
      if (killReason === "abort") {
        resolve({ kind: "aborted", stdout, stderr, exitCode: null });
        return;
      }
      if (termSignal !== null && killReason !== "timeout") {
        resolve({ kind: "error", stdout, stderr, exitCode: null, errorName: `Signal ${termSignal}` });
        return;
      }
      if (termSignal !== null) {
        resolve({ kind: "timeout", stdout, stderr, exitCode: null });
        return;
      }
      // Helper-level setup failure (the target never ran): exit 3 plus this spawn's
      // authenticated sentinel maps to a process error, never to the child exit code.
      if (sandbox !== undefined && code === 3 && isSandboxSetupFailure(stderr, sandboxNonce)) {
        resolve({ kind: "error", stdout, stderr, exitCode: null, errorMessage: sandboxSetupFailureReason(stderr, sandboxNonce) });
        return;
      }
      resolve({ kind: "ok", stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

/** Options for a persistent interactive shell (cause-owned lifetime like jobs). */
export interface PersistentShellOptions {
  cwd: string;
}

/**
 * Handle to one owner-isolated persistent shell: stdin stays open so `cd`,
 * `export`, and other session state survive across writes. Output is combined
 * stdout+stderr in arrival order, capped like background jobs. Framing (which
 * bytes belong to which command) is the caller's job — this stays dumb pipes.
 */
export interface PersistentShell {
  readonly pid: number | undefined;
  alive(): boolean;
  /** Writes raw bytes to shell stdin (the caller appends newlines/markers). */
  write(data: string): void;
  /** Combined output so far (capped). */
  output(): string;
  /** Closes stdin then SIGTERMs (EOF lets `exit`-less shells finish first). */
  kill(): void;
}

/**
 * Spawns `bash --noprofile --norc -s` (POSIX only): hermetic, reads commands
 * from stdin, no prompt on pipes. Throws WorkspaceError when bash is missing
 * or the spawn itself fails. Windows callers must fail closed upstream —
 * interactive PowerShell framing is a separate backend, not a flag flip.
 *
 * @param options Working directory the shell starts in.
 * @returns Live shell handle (write/output/alive/kill); caller owns framing and lifetime.
 */
export function spawnPersistentShell(options: PersistentShellOptions): PersistentShell {
  if (process.platform === "win32") {
    throw new WorkspaceError("Error: persistent shell needs POSIX bash (use bash/run_job on Windows)");
  }
  const { cwd } = options;
  let child: ChildProcess;
  try {
    child = spawn("bash", ["--noprofile", "--norc", "-s"], {
      cwd,
      shell: false,
      env: childProcessEnv(),
      windowsHide: true,
    });
    child.unref();
  } catch (error) {
    throw new WorkspaceError(`Error: cannot start persistent shell (${(error as Error).message})`);
  }
  let buffer = "";
  let running = true;
  let escalate: NodeJS.Timeout | null = null;
  const shellDecoder = new StreamDecoder();
  const append = (chunk: Buffer) => {
    if (buffer.length < MAX_OUTPUT_CHARS) buffer += shellDecoder.decode(chunk);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  const settle = () => {
    running = false;
    if (escalate !== null) {
      clearTimeout(escalate);
      escalate = null;
    }
  };
  child.on("error", settle);
  child.on("close", settle);
  return {
    pid: child.pid,
    alive: () => running && child.exitCode === null && child.signalCode === null,
    write: (data: string) => {
      if (!running) throw new WorkspaceError("Error: persistent shell is closed");
      try {
        child.stdin?.write(data);
      } catch (error) {
        throw new WorkspaceError(`Error: shell write failed (${(error as Error).message})`);
      }
    },
    output: () => buffer,
    kill: () => {
      try {
        child.stdin?.end();
      } catch {
        // Already closed: fall through to the signal path.
      }
      if (!running) return;
      try {
        child.kill();
      } catch {
        return;
      }
      if (escalate !== null) clearTimeout(escalate);
      escalate = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already gone: the close handler reports the real outcome.
        }
      }, KILL_ESCALATE_MS);
      escalate.unref?.();
    },
  };
}

/** Background job spawn options (no timeout: the caller owns the lifetime via poll/kill). */
export interface BackgroundJobOptions {
  argv: string[];
  cwd: string;
  /** When set, the child spawns under the OS write-restricted sandbox (fail-closed where unenforceable). */
  sandbox?: ProcessSandboxRequest;
}

/**
 * Handle to a running-or-finished background child. Output is combined
 * stdout+stderr in arrival order, capped so chatty servers cannot fill memory.
 * Process-scoped: a server restart orphans the OS process (documented at the
 * tool layer); never used for anything requiring durability.
 */
export interface BackgroundJob {
  readonly pid: number | undefined;
  /** True while the OS process is still alive. */
  alive(): boolean;
  /** Exit code once reaped, null while running or signal-killed. */
  exitCode(): number | null;
  /** Combined output so far (capped). */
  output(): string;
  /** Reason when the sandbox helper failed at setup (exit 3 + authenticated sentinel); null otherwise. */
  sandboxSetupFailure(): string | null;
  /** SIGTERM now, SIGKILL escalation on the shared schedule; safe to call twice. */
  kill(): void;
}

/**
 * Spawns a background child (no shell involved): same env allowlist, stdio
 * handling, and output caps as runProcess, but no timeout and no promise —
 * lifetime is caller-owned. Throws WorkspaceError when the spawn itself fails
 * (bad cwd); a bad binary surfaces later as an exited job (see exitCode/error).
 *
 * @param options argv plus working directory (no timeout: poll/kill own the lifetime).
 * @returns Live job handle (pid/alive/exitCode/output/kill).
 */
export function spawnBackground(options: BackgroundJobOptions): BackgroundJob {
  const { argv, cwd, sandbox } = options;
  // Authenticated per-spawn marker for setup-failure reporting (parity with runProcess).
  const sandboxNonce = sandbox === undefined ? "" : createSandboxNonce();
  let child: ChildProcess;
  try {
    const effectiveArgv = sandbox === undefined ? argv : sandboxSpawnTransform()(argv, cwd, sandbox, sandboxNonce);
    child = spawn(effectiveArgv[0] ?? "", effectiveArgv.slice(1), {
      cwd,
      shell: false,
      env: childProcessEnv(),
      windowsHide: true,
    });
    // Same as runProcess: input-waiting commands hit EOF instead of hanging.
    child.stdin?.end();
    // Jobs must not hold server shutdown open; the OS process keeps running
    // (orphan risk on restart is documented, not silently solved).
    child.unref();
  } catch (error) {
    // Transform refusals (unenforceable sandbox request) keep their own message.
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError(`Error: cannot start background job (${(error as Error).message})`);
  }
  let buffer = "";
  let code: number | null = null;
  let running = true;
  let escalate: NodeJS.Timeout | null = null;
  const jobDecoder = new StreamDecoder();
  child.stdout?.on("data", (chunk: Buffer) => {
    if (buffer.length < MAX_OUTPUT_CHARS) buffer += jobDecoder.decode(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    if (buffer.length < MAX_OUTPUT_CHARS) buffer += jobDecoder.decode(chunk);
  });
  child.on("error", () => {
    // Bad binary and friends: mark finished; the exit code stays null and the
    // buffered output (often empty) is whatever the OS gave us.
    running = false;
    if (escalate !== null) {
      clearTimeout(escalate);
      escalate = null;
    }
  });
  child.on("exit", (exitCode) => {
    // Early code capture only: running stays true until close so late pipe
    // output still lands in the buffer (same grandchild lesson as runProcess).
    code = exitCode;
  });
  child.on("close", (exitCode) => {
    running = false;
    code = exitCode;
    if (escalate !== null) {
      clearTimeout(escalate);
      escalate = null;
    }
  });
  return {
    pid: child.pid,
    alive: () => running && child.exitCode === null && child.signalCode === null,
    exitCode: () => code,
    output: () => buffer,
    sandboxSetupFailure: () =>
      sandbox !== undefined && code === 3 && isSandboxSetupFailure(buffer, sandboxNonce)
        ? sandboxSetupFailureReason(buffer, sandboxNonce)
        : null,
    kill: () => {
      if (!running) return;
      try {
        child.kill();
      } catch {
        return;
      }
      if (escalate !== null) clearTimeout(escalate);
      escalate = setTimeout(() => {
        try {
          if (running) child.kill("SIGKILL");
        } catch {
          // Already gone: the close handler reports the real outcome.
        }
      }, KILL_ESCALATE_MS);
      escalate.unref?.();
    },
  };
}

/**
 * Command splitting: posix (non-Windows) strips quotes per shell rules;
 * Windows keeps quote characters inside the token (matching the legacy behavior).
 */
export function splitShellCommand(command: string, posix: boolean): string[] {
  const tokens: string[] = [];
  let current = "";
  let hasToken = false;
  let quote: '"' | "'" | null = null;

  const flush = () => {
    if (hasToken) tokens.push(current);
    current = "";
    hasToken = false;
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote !== null) {
      if (posix && ch === "\\" && i + 1 < command.length && (command[i + 1] === quote || command[i + 1] === "\\")) {
        current += command[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
        if (!posix) current += ch;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      if (!posix) current += ch;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n") {
      flush();
      continue;
    }
    if (posix && ch === "\\") {
      if (i + 1 < command.length) {
        current += command[i + 1];
        i += 1;
        hasToken = true;
        continue;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  flush();
  return tokens;
}
