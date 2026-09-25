/**
 * @file sandbox-launcher
 * @description OS write-sandbox spawn transform for child processes (Windows).
 *
 * Responsibilities:
 * - Transform (argv, cwd, writableRoots) into a spawn through the restricted-token helper
 * - Materialize the helper script under the OS temp dir (once, atomic rename)
 * - Fail closed: any setup failure surfaces as a process error, never an unsandboxed spawn
 *
 * Terminology note: "sandbox" here means OS-level write containment for one
 * spawn (restricted token + ACL), not the command safety policy and approval
 * gates provided by the @agentprism/sandbox package, which decides whether a
 * command may run at all; the two layers compose but are unrelated.
 *
 * The transform keeps one spawn contract for the process runner: the helper
 * inherits the host's stdio pipes and exits with the target's exit code, so
 * timeout, abort, and output caps work unchanged. A per-spawn nonce marks
 * setup-failure lines so a sandboxed command echoing the sentinel cannot fake one.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WorkspaceError } from "./scoped-filesystem.js";
import { SANDBOX_SETUP_SENTINEL, WIN_SANDBOX_HELPER_CS, WIN_SANDBOX_HELPER_PS1 } from "./win-sandbox-helper.js";

export { SANDBOX_SETUP_SENTINEL };

/** Write-containment request attached to a spawn: the child may write only inside this root. */
export interface ProcessSandboxRequest {
  /**
   * The single directory root the child may write; every other path stays read-only
   * (reads are unrestricted). Multi-root requests are refused by the transform
   * rather than silently narrowed to the first root.
   */
  readonly writableRoots: readonly string[];
}

/** Rewrites argv for a sandboxed spawn. Throws WorkspaceError when the request is unenforceable. */
export type SandboxSpawnTransform = (
  argv: string[],
  cwd: string,
  sandbox: ProcessSandboxRequest,
  nonce: string,
  platform?: NodeJS.Platform,
) => string[];

/** The sandboxed interpreter: PowerShell 5.1 ships with every supported Windows version. */
const WIN32_HELPER_SHELL = "powershell.exe";
const WIN32_HELPER_SHELL_ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"];

/** Directory under the OS temp dir holding the materialized helper (and its assembly cache). */
function helperDir(): string {
  return path.join(tmpdir(), "agent-prism-sandbox");
}

/** Writes the helper script + C# source once (atomic rename; concurrent spawns converge). */
function materializeHelper(): string {
  const dir = helperDir();
  mkdirSync(dir, { recursive: true });
  const helperPath = path.join(dir, "win-sandbox.ps1");
  const csPath = path.join(dir, "SandboxSpawn.cs");
  const dllPath = path.join(dir, "SandboxSpawn.dll");
  try {
    // A changed C# source must invalidate the cached assembly BEFORE the source is
    // updated: deleting first means a DLL still loaded by another helper keeps this
    // spawn failing loudly, instead of the next spawn seeing the new source, skipping
    // the delete, and silently loading stale containment code.
    if (sourceDiffers(csPath, WIN_SANDBOX_HELPER_CS)) rmSync(dllPath, { force: true });
    writeIfChanged(csPath, WIN_SANDBOX_HELPER_CS);
    writeIfChanged(helperPath, WIN_SANDBOX_HELPER_PS1);
  } catch (error) {
    throw new WorkspaceError(`Error: cannot materialize sandbox helper (${(error as Error).message})`);
  }
  return helperPath;
}

/** Writes when missing or diverged; true when the file content changed. */
function writeIfChanged(target: string, content: string): boolean {
  if (!sourceDiffers(target, content)) return false;
  writeAtomic(target, content);
  return true;
}

/** True when the file is missing or its content diverges from the shipped source. */
function sourceDiffers(target: string, content: string): boolean {
  try {
    return readFileSync(target, "utf-8") !== content;
  } catch {
    // Missing or unreadable: treat as diverged and rewrite.
    return true;
  }
}

function writeAtomic(target: string, content: string): void {
  const temp = target + "." + process.pid + ".tmp";
  writeFileSync(temp, content, "utf-8");
  renameSync(temp, target);
}

/** Default transform: wrap the argv in the restricted-token helper invocation. */
function defaultSandboxSpawnTransform(argv: string[], cwd: string, sandbox: ProcessSandboxRequest, nonce: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform !== "win32") {
    throw new WorkspaceError("Error: OS write sandbox is only enforced on Windows; refusing to run unsandboxed");
  }
  if (sandbox.writableRoots.length !== 1) {
    throw new WorkspaceError(
      `Error: OS write sandbox requires exactly one writable root, got ${sandbox.writableRoots.length}`,
    );
  }
  const helperPath = materializeHelper();
  return [
    WIN32_HELPER_SHELL,
    ...WIN32_HELPER_SHELL_ARGS,
    helperPath,
    "-CommandJson",
    JSON.stringify(argv),
    "-Cwd",
    cwd,
    "-WritableRootsJson",
    JSON.stringify(sandbox.writableRoots),
    "-Nonce",
    nonce,
  ];
}

let sandboxTransformOverride: SandboxSpawnTransform | null = null;

/**
 * Replaces the transform (tests and alternative platform launchers); null restores the default.
 * The transform only rewrites argv — containment is enforced by the helper process — so this
 * seam is process-internal and trusted (any in-process caller can run code already); it is
 * not a boundary against in-process code, and a transform that returns argv unchanged would
 * spawn unsandboxed.
 */
export function setSandboxSpawnTransform(transform: SandboxSpawnTransform | null): void {
  sandboxTransformOverride = transform;
}

/** The active transform (injected override or the Windows default). */
export function sandboxSpawnTransform(): SandboxSpawnTransform {
  return sandboxTransformOverride ?? defaultSandboxSpawnTransform;
}

/** Fresh per-spawn nonce for sentinel authentication. */
export function createSandboxNonce(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** True when stderr carries this spawn's authenticated setup-failure line. */
export function isSandboxSetupFailure(stderr: string, nonce: string): boolean {
  return stderr.includes(SANDBOX_SETUP_SENTINEL + nonce + ":");
}

/** Extracts the human-readable reason after the authenticated sentinel line. */
export function sandboxSetupFailureReason(stderr: string, nonce: string): string {
  const marker = SANDBOX_SETUP_SENTINEL + nonce + ":";
  const start = stderr.indexOf(marker);
  if (start < 0) return "sandbox setup failed";
  const rest = stderr.slice(start + marker.length);
  const line = rest.split(/\r?\n/, 1)[0] ?? "";
  return line.trim() === "" ? "sandbox setup failed" : `sandbox setup failed: ${line.trim()}`;
}
