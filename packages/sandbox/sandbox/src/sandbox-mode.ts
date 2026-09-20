/**
 * @file sandbox-mode
 * @description Sandbox mode normalization over the OS write-containment switch.
 *
 * Responsibilities:
 * - Re-export the SandboxMode union (contract single source: contracts/enums)
 * - Normalize unknown modes fail-safe to off (with a loud console warning)
 */

import type { SandboxMode } from "@agentprism/contracts";

export type { SandboxMode };

/** Normalizes an untrusted config string; unknown values fall back to off, loudly (opt-in containment can never be silently enabled). */
export function normalizeSandboxMode(raw: unknown): SandboxMode {
  if (raw === "off" || raw === "os") return raw;
  if (raw !== undefined && raw !== null && raw !== "") {
    console.warn(`[sandbox] unknown sandbox_mode ${String(raw)}; falling back to off`);
  }
  return "off";
}
