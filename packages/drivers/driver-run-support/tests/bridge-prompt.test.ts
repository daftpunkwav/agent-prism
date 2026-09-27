/**
 * @file bridge-prompt tests
 * @description Locks the arena prompt assembly the Python framework bridges apply.
 *
 * Responsibilities:
 * - Pin the system merge (one turn, arena prompt in front of the child's role copy)
 * - Pin the history splice (after the leading system turn, same rules as in-process)
 */

import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@agentprism/contracts";
import { withArenaSystem, withHistory } from "../src/bridge-prompt.js";

const task: LlmMessage = { role: "user", content: "task" };

describe("withArenaSystem", () => {
  it("merges the arena prompt into the child's leading system turn", () => {
    const messages: LlmMessage[] = [{ role: "system", content: "[role copy]" }, task];
    expect(withArenaSystem(messages, "ARENA")).toEqual([
      { role: "system", content: "ARENA\n\n[role copy]" },
      task,
    ]);
  });

  it("adds a system turn when the child sent none", () => {
    expect(withArenaSystem([task], "ARENA")).toEqual([{ role: "system", content: "ARENA" }, task]);
  });
});

describe("withHistory", () => {
  it("splices prior turns after the leading system turn", () => {
    const messages: LlmMessage[] = [{ role: "system", content: "s" }, task];
    const withTurns = withHistory(messages, [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
    ]);
    expect(withTurns).toEqual([
      { role: "system", content: "s" },
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      task,
    ]);
  });

  it("keeps the child's transcript untouched without history", () => {
    const messages: LlmMessage[] = [{ role: "system", content: "s" }, task];
    expect(withHistory(messages, [])).toBe(messages);
    expect(withHistory(messages, undefined)).toBe(messages);
  });
});
