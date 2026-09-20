/**
 * @file telemetry test
 * @description Locks lifecycle counters, idempotency, and text reports.
 */
import { describe, expect, it } from "vitest";
import { SessionTelemetry } from "../src/counters.js";
import { renderTelemetryReport } from "../src/report.js";

describe("SessionTelemetry", () => {
  it("counts starts, terminals, entries, and durations", () => {
    const telemetry = new SessionTelemetry();
    expect(renderTelemetryReport(telemetry)).toContain("no sessions");
    telemetry.started("a", "arena", 1000);
    telemetry.started("a", "arena", 1000);
    telemetry.entries("a", 3);
    telemetry.settledTransition("a", "completed", 6000);
    telemetry.settledTransition("a", "failed", 7000);
    expect(telemetry.snapshot().arena).toMatchObject({ started: 1, completed: 1, failed: 0, entries: 3 });
    expect(telemetry.meanDurationMs("arena")).toBe(5000);
    expect(telemetry.openSessions()).toBe(0);
    const text = renderTelemetryReport(telemetry);
    expect(text).toContain("arena: started=1 completed=1");
    expect(text).toContain("mean_ms=5000");
  });

  it("attributes orphan transitions to agent and ignores non-terminal noise", () => {
    const telemetry = new SessionTelemetry();
    telemetry.settledTransition("ghost", "failed", 5);
    telemetry.settledTransition("ghost", "active" as never, 6);
    expect(telemetry.snapshot().agent.failed).toBe(1);
    expect(telemetry.snapshot().agent.completed).toBe(0);
    telemetry.entries("ghost", -2);
    expect(telemetry.snapshot().agent.entries).toBe(0);
  });
});
