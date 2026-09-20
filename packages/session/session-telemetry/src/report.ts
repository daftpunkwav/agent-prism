/**
 * @file session-telemetry/report
 * @description Deterministic telemetry text summaries.
 *
 * Responsibilities:
 * - Render per-kind counters plus means as stable log lines
 * - Keep output short, sorted, and free of timestamps (diffable)
 */

import type { SessionKind } from "@agentprism/contracts";
import type { SessionTelemetry } from "./counters.js";

const KINDS: SessionKind[] = ["arena", "agent", "builder"];

/** Renders one telemetry snapshot as stable lines. */
export function renderTelemetryReport(telemetry: SessionTelemetry): string {
  const snapshot = telemetry.snapshot();
  const lines = KINDS.filter((kind) => {
    const counters = snapshot[kind];
    return counters.started > 0;
  }).map((kind) => {
    const counters = snapshot[kind];
    const mean = telemetry.meanDurationMs(kind);
    return (
      `${kind}: started=${counters.started} completed=${counters.completed} ` +
      `failed=${counters.failed} cancelled=${counters.cancelled} entries=${counters.entries} ` +
      `mean_ms=${Math.round(mean)} max_ms=${counters.maxDurationMs}`
    );
  });
  if (lines.length === 0) return "[Session telemetry] no sessions observed";
  return ["[Session telemetry]", ...lines, `open=${telemetry.openSessions()}`].join("\n");
}
