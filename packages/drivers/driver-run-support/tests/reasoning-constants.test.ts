/**
 * @file reasoning-constants test
 * @description Locks the env-tunable ToT width knob and score parsing.
 */
import { describe, expect, it } from "vitest";
import { parseScoreVerdict, selfConsistencyAttempts, totWidth } from "../src/reasoning-constants.js";

describe("totWidth", () => {
  it("defaults to 3 when the env knob is absent or invalid", () => {
    expect(totWidth({} as NodeJS.ProcessEnv)).toBe(3);
    expect(totWidth({ ARENA_TOT_WIDTH: "abc" } as NodeJS.ProcessEnv)).toBe(3);
    expect(totWidth({ ARENA_TOT_WIDTH: "" } as NodeJS.ProcessEnv)).toBe(3);
  });

  it("clamps into the 2-5 range", () => {
    expect(totWidth({ ARENA_TOT_WIDTH: "1" } as NodeJS.ProcessEnv)).toBe(2);
    expect(totWidth({ ARENA_TOT_WIDTH: "4" } as NodeJS.ProcessEnv)).toBe(4);
    expect(totWidth({ ARENA_TOT_WIDTH: "99" } as NodeJS.ProcessEnv)).toBe(5);
  });
});

describe("selfConsistencyAttempts", () => {
  it("defaults to 5 attempts when the env knob is absent or invalid", () => {
    expect(selfConsistencyAttempts({} as NodeJS.ProcessEnv)).toBe(5);
    expect(selfConsistencyAttempts({ ARENA_SELF_CONSISTENCY_N: "x" } as NodeJS.ProcessEnv)).toBe(5);
  });

  it("clamps into the 2-9 range", () => {
    expect(selfConsistencyAttempts({ ARENA_SELF_CONSISTENCY_N: "1" } as NodeJS.ProcessEnv)).toBe(2);
    expect(selfConsistencyAttempts({ ARENA_SELF_CONSISTENCY_N: "7" } as NodeJS.ProcessEnv)).toBe(7);
    expect(selfConsistencyAttempts({ ARENA_SELF_CONSISTENCY_N: "50" } as NodeJS.ProcessEnv)).toBe(9);
  });
});

describe("parseScoreVerdict", () => {
  it("parses 0-10 scores with optional /10 suffix, case-insensitive", () => {
    expect(parseScoreVerdict("SCORE: 8")).toBe(8);
    expect(parseScoreVerdict("score: 10 / 10\nsolid plan")).toBe(10);
    expect(parseScoreVerdict("Score: 0")).toBe(0);
  });

  it("returns null when no score line is present", () => {
    expect(parseScoreVerdict("looks fine")).toBeNull();
    expect(parseScoreVerdict("")).toBeNull();
  });
});
