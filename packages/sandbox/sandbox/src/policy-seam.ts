/**
 * @file policy-seam
 * @description Type-only contract shared by every sandbox policy implementation.
 *
 * Responsibilities:
 * - Define the SandboxVerdict and SandboxPolicy seam (verdict per shell command)
 *
 * Types live apart from the implementations so the deny-list, the layered
 * analysis, and the approval gate can depend on the contract without any
 * implementation-to-implementation import (dependency graph stays acyclic).
 */

/** Block reason, or null when the command may proceed. */
export type SandboxVerdict = string | null;

/** Shell-command safety seam consumed through the registry beforeExecute hook. */
export interface SandboxPolicy {
  reviewShellCommand(command: string, platform?: string): SandboxVerdict;
}
