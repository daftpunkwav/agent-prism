/**
 * @file check-workflow-downloads fixtures
 * @description Shared scaffolding for the download-gate test suites.
 *
 * Responsibilities:
 * - Run the gate CLI against fixture directories and report status/stdout/stderr
 * - Build throwaway workflow files and remove them after the suite
 *
 * Support module, not a test: no `.test` suffix, so the runner never picks it up.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const GATE = join(REPO_ROOT, "scripts", "ci", "check_workflow_downloads.mjs");

const workspaces: string[] = [];

export type GateResult = { status: number; stdout: string; stderr: string };

/** Runs the gate CLI against a directory without fixture files. */
export function runGateDir(dir: string): GateResult {
  try {
    const stdout = execFileSync(process.execPath, [GATE, dir], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

/** Writes fixture workflow files into a fresh temp directory and runs the gate on it. */
export function runGate(files: Record<string, string>): GateResult {
  const dir = mkdtempSync(join(tmpdir(), "workflow-downloads-"));
  workspaces.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return runGateDir(dir);
}

/** Wraps a run-block body into a minimal workflow file. */
export function workflow(runBlock: string): Record<string, string> {
  return { "demo.yml": `jobs:\n  demo:\n    steps:\n      - run: |\n${runBlock}\n` };
}

/** Removes every fixture directory created by runGate. */
export function cleanupWorkspaces(): void {
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
}
