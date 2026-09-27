/**
 * @file model-call health wiring tests
 * @description Locks how a driver's endpoint-health reports reach the host.
 *
 * Responsibilities:
 * - Pin that the spec's hook lands on the execution context the driver sees
 * - Pin that a driver owning its transport reports through it
 *
 * The Claude CLI column has no chat-model callbacks, so this context hook is the only
 * path that can feed the arena breaker for that column; dropping it in the agent layer
 * would silently disable the breaker for that framework, the way an unwired option did
 * for the model factory before.
 */

import { describe, expect, it } from "vitest";
import type { ModelCallOutcome } from "@agentprism/contracts";
import { captureDriver, collect, testDeps, testSpec } from "./run-fixtures.js";

describe("model-call health wiring", () => {
  it("hands the spec's hook to the driver context", async () => {
    const outcomes: ModelCallOutcome[] = [];
    let seen: ((outcome: ModelCallOutcome) => void) | undefined;

    await collect(
      testDeps(),
      testSpec(
        captureDriver((ctx) => {
          seen = ctx.onModelCall;
        }),
        { onModelCall: (outcome) => outcomes.push(outcome) },
      ),
    );

    expect(seen).toBeDefined();
    seen?.({ ok: false, error: new Error("provider 503") });
    expect(outcomes).toMatchObject([{ ok: false }]);
  });

  it("leaves the hook absent when the host does not ask for health", async () => {
    let seen: unknown = "unset";
    await collect(
      testDeps(),
      testSpec(
        captureDriver((ctx) => {
          seen = ctx.onModelCall;
        }),
      ),
    );
    expect(seen).toBeUndefined();
  });
});
