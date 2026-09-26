/**
 * @file cli-path
 * @description Locates the Claude Code CLI the SDK subprocess runs.
 *
 * Responsibilities:
 * - Honor the ARENA_CLAUDE_CODE_PATH override, failing fast when it is wrong
 * - Fall back to a globally installed Claude Code (native binary or JS entry)
 *
 * The SDK resolves only its own bundled native binary (a per-platform optional
 * dependency this repo deliberately does not install: hundreds of MB, and the
 * download is unreliable) and has no PATH fallback, so the launcher is resolved
 * here. Returning undefined lets the SDK try its bundled binary before the run
 * fails with its own message.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { ConfigurationError } from "@agentprism/contracts";

/** Env var overriding CLI discovery (window: set it to the executable or cli.js path). */
export const CLAUDE_CODE_PATH_ENV = "ARENA_CLAUDE_CODE_PATH";

/** Relative locations of a globally installed Claude Code inside an npm prefix. */
const GLOBAL_CLI_CANDIDATES = [
  path.join("node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
  path.join("node_modules", "@anthropic-ai", "claude-code", "cli.js"),
];

/** Launcher names to look for directly in a PATH directory (Windows before POSIX). */
const PATH_LAUNCHERS = ["claude.exe", "claude"];

/**
 * Resolves the Claude Code CLI path.
 *
 * @param env Environment to read (PATH + the override).
 * @param exists Existence probe (injected for tests).
 * @returns Absolute CLI path, or undefined when nothing is found.
 * @throws ConfigurationError when the override is set but does not exist.
 */
export function resolveClaudeCodePath(
  env: NodeJS.ProcessEnv = process.env,
  exists: (candidate: string) => boolean = existsSync,
): string | undefined {
  const override = env[CLAUDE_CODE_PATH_ENV]?.trim();
  if (override !== undefined && override !== "") {
    if (!exists(override)) {
      throw new ConfigurationError(`${CLAUDE_CODE_PATH_ENV} points at a missing file: ${override}`);
    }
    return override;
  }
  const entries = (env["PATH"] ?? "").split(path.delimiter).filter((entry) => entry !== "");
  // Global npm installs keep the real launcher inside node_modules; prefer it
  // over the .cmd/.ps1 shims, which cannot be spawned without a shell.
  for (const entry of entries) {
    for (const candidate of GLOBAL_CLI_CANDIDATES) {
      const full = path.join(entry, candidate);
      if (exists(full)) return full;
    }
  }
  for (const entry of entries) {
    for (const launcher of PATH_LAUNCHERS) {
      const full = path.join(entry, launcher);
      if (exists(full)) return full;
    }
  }
  return undefined;
}
