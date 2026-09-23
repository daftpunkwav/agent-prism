/**
 * @file turn runner failure tests
 * @description Locks the failure path of runBuilderTurn: the output promise must
 * settle even when the trace sink itself throws inside the failure handler
 * (a throwing sink must strand the consumer on a forever-pending promise).
 */
import { describe, expect, it } from "vitest";
import { BuilderCompositionSchema } from "@agentprism/contracts";
import type { BuilderStreamChunk } from "@agentprism/contracts";
import { runBuilderTurn, type BuilderTurnDeps, type BuilderTurnInput } from "../src/turn-runner.js";

describe("runBuilderTurn failure path", () => {
  it("settles the turn output when the trace sink throws while reporting the failure", async () => {
    const deps = {
      // First statement of the pump: throws before any runtime is built.
      driverLookup: {
        get: () => {
          throw new Error("driver lookup exploded");
        },
      },
    } as unknown as BuilderTurnDeps;
    const hooks = {
      appendTrace: () => {
        throw new Error("trace sink broke");
      },
    };
    const input: BuilderTurnInput = {
      sessionId: "s1",
      turn: 1,
      message: "do the task",
      composition: BuilderCompositionSchema.parse({ framework: "native" }),
      history: [],
      thinkingCapable: false,
      notices: [],
    };

    const iterator = runBuilderTurn(deps, hooks, input);
    const chunks: BuilderStreamChunk[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = (async () => {
      for (;;) {
        const { value, done } = await iterator.next();
        if (done) return value;
        chunks.push(value);
      }
    })();
    try {
      // Bounded wait: without the fix the output promise never settles, so the
      // test must fail with a clear message, not a 30s harness timeout.
      const output = await Promise.race([
        settled,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("turn output did not settle within 5s")), 5_000);
        }),
      ]);
      expect(output.answer).toBe("");
      expect(output.errorSeen).toBe(true);
      expect(output.metrics).toBeNull();
      // The failure still reaches the stream as a fatal error chunk.
      const fatal = chunks.find((chunk) => chunk.stream === "error");
      expect(fatal).toBeDefined();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  });
});
