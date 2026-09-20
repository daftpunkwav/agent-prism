/**
 * @file approval
 * @description Approval gate over the beforeExecute seam, keyed by run mode.
 *
 * Responsibilities:
 * - Re-export the ApprovalMode union (contract single source: contracts/enums) and ship the gate
 * - In unless_trusted mode, allow only known-safe shell commands; every other
 *   tool passes (toolset filters and the scoped filesystem own those surfaces)
 * - Normalize unknown modes fail-closed to unless_trusted
 *
 * The gate may only add denials (same invariant as the sandbox guard): it runs
 * ahead of the sandbox policy on the beforeExecute chain and never overrides a
 * caller hook denial. Interactive approval (ask-once-then-cache) is future
 * work; both shipped modes are unattended-safe.
 */

import type { ApprovalMode, ToolArgs } from "@agentprism/contracts";
import { isKnownSafeCommand } from "./command-analysis.js";

export type { ApprovalMode };

/** Reject reason, or null when the call may proceed. */
export type ApprovalVerdict = string | null;

/** Tools whose args carry a shell command subject to shell review. */
const SHELL_TOOLS = new Set(["run", "run_job", "bash_session"]);

/** Extracts the shell command from a tool's args using each tool's own shape; empty when none. */
function shellCommandOf(name: string, args: ToolArgs): string {
  const action = typeof args.action === "string" ? args.action : "";
  if (name === "run") return typeof args.command === "string" ? args.command : "";
  if (name === "run_job") return action === "start" && typeof args.command === "string" ? args.command : "";
  if (name === "bash_session") return action === "send" && typeof args.command === "string" ? args.command : "";
  return "";
}

/** Normalizes an untrusted config string; unknown values fail closed. */
export function normalizeApprovalMode(raw: unknown): ApprovalMode {
  if (raw === "auto" || raw === "unless_trusted") return raw;
  if (raw !== undefined && raw !== null && raw !== "") {
    console.warn(`[sandbox] unknown approval_mode ${String(raw)}; falling back to unless_trusted`);
  }
  return "unless_trusted";
}

/**
 * Per-execution approval policy. Stateless reviews only: no session cache yet
 * (there is no interactive approval to cache); unless_trusted is a pure filter.
 */
export class ApprovalGate {
  private readonly mode: ApprovalMode;

  constructor(mode: ApprovalMode = "auto") {
    this.mode = mode;
  }

  review(name: string, args: ToolArgs): ApprovalVerdict {
    if (this.mode === "auto") return null;
    if (!SHELL_TOOLS.has(name)) return null;
    const command = shellCommandOf(name, args);
    if (command.trim() === "") return null;
    if (isKnownSafeCommand(command)) return null;
    return `Error: command not approved by approval policy (mode=unless_trusted; only known-safe read-only commands run without approval): ${command.slice(0, 120)}`;
  }
}
