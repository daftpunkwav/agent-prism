/**
 * @file episodic tests
 * @description Locks experience recording, similar-task recall, and dedup.
 *
 * Responsibilities:
 * - Pin recording, similar-task recall ordering, and recall caps
 * - Lock dedup: identical/near-duplicate reports merge, distinct outcomes stay
 */

import { describe, expect, it } from "vitest";
import { EpisodicMemory } from "../src/episodic.js";

function memory(): EpisodicMemory {
  let now = 1_000_000;
  return new EpisodicMemory({ now: () => now++ });
}

describe("EpisodicMemory", () => {
  it("records and recalls similar tasks first", async () => {
    const mem = memory();
    await mem.recordExperience({
      task: "run factorial script with node",
      framework: "native",
      model: "test",
      success: true,
      keyActions: ["bash", "read"],
      lessons: "try node instead of python for scripts",
      workspaceTag: "",
    });
    await mem.recordExperience({
      task: "bake a chocolate cake",
      framework: "native",
      model: "test",
      success: true,
      keyActions: ["read"],
      lessons: "preheat the oven",
      workspaceTag: "",
    });
    const hits = await mem.recallExperiences("factorial script node", { limit: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.task).toContain("factorial");
  });

  it("caps recall at the requested limit", async () => {
    const mem = memory();
    for (let i = 0; i < 5; i += 1) {
      await mem.recordExperience({
        task: `node script task ${i}`,
        framework: "",
        model: "",
        success: true,
        keyActions: ["bash"],
        lessons: "node lesson",
        workspaceTag: "",
      });
    }
    expect(await mem.recallExperiences("node script", { limit: 3 })).toHaveLength(3);
  });

  it("deduplicates identical reports instead of appending", async () => {
    const mem = memory();
    const base = {
      task: "  Run Factorial Script ",
      framework: "native",
      model: "m",
      success: true,
      keyActions: ["bash"],
      lessons: "use node",
      workspaceTag: "",
    };
    await mem.recordExperience(base);
    await mem.recordExperience({ ...base, keyActions: ["read"] });
    expect(mem.size).toBe(1);
    expect(mem.list()[0]?.keyActions.sort()).toEqual(["bash", "read"]);
  });

  it("keeps distinct outcomes as separate entries", async () => {
    const mem = memory();
    const base = {
      task: "deploy script",
      framework: "",
      model: "",
      success: true,
      keyActions: [] as string[],
      lessons: "worked",
      workspaceTag: "",
    };
    await mem.recordExperience(base);
    await mem.recordExperience({ ...base, success: false, lessons: "failed on network" });
    expect(mem.size).toBe(2);
  });
});

describe("EpisodicMemory dedup", () => {
  it("merges a near-duplicate report instead of appending a new entry", async () => {
    const mem = memory();
    await mem.recordExperience({
      task: "Run Factorial Script",
      framework: "native",
      model: "test",
      success: true,
      keyActions: ["bash"],
      lessons: "use node",
      workspaceTag: "",
    });
    await mem.recordExperience({
      task: "run factorial script", // same normalized task, same outcome+lessons
      framework: "native",
      model: "test",
      success: true,
      keyActions: ["bash", "read"], // new action folds into the merged entry
      lessons: "use node",
      workspaceTag: "ws-2",
    });
    expect(mem.size).toBe(1);
    const [merged] = await mem.recallExperiences("factorial", { limit: 1 });
    expect(merged?.keyActions).toEqual(["bash", "read"]);
    expect(merged?.workspaceTag).toBe("ws-2");
  });

  it("keeps distinct outcomes or lessons as separate entries", async () => {
    const mem = memory();
    for (const success of [true, false]) {
      await mem.recordExperience({
        task: "same task",
        framework: "",
        model: "",
        success,
        keyActions: [],
        lessons: "",
        workspaceTag: "",
      });
    }
    expect(mem.size).toBe(2);
  });
});

describe("EpisodicMemory capacity", () => {
  it("trims the oldest entries once the cap is reached", async () => {
    let now = 1_000;
    const mem = new EpisodicMemory({ maxEntries: 3, now: () => now++ });
    for (let i = 1; i <= 4; i += 1) {
      await mem.recordExperience({
        task: `task ${i}`,
        framework: "",
        model: "",
        success: true,
        keyActions: [],
        lessons: `lesson ${i}`,
        workspaceTag: "",
      });
    }

    expect(mem.size).toBe(3);
    const tasks = mem.list().map((entry) => entry.task);
    // The oldest experience is the one that goes; the newest survives the cap.
    expect(tasks).not.toContain("task 1");
    expect(tasks).toEqual(expect.arrayContaining(["task 2", "task 3", "task 4"]));
  });

  it("refreshes a near-duplicate in place without evicting for the update", async () => {
    let now = 1_000;
    const mem = new EpisodicMemory({ maxEntries: 3, now: () => now++ });
    for (let i = 1; i <= 3; i += 1) {
      await mem.recordExperience({
        task: `task ${i}`,
        framework: "",
        model: "",
        success: true,
        keyActions: ["bash"],
        lessons: `lesson ${i}`,
        workspaceTag: "",
      });
    }
    // A dup update grows the store by zero entries: nothing may be evicted for it.
    await mem.recordExperience({
      task: "Task 3",
      framework: "",
      model: "",
      success: true,
      keyActions: ["read"],
      lessons: "lesson 3",
      workspaceTag: "",
    });

    expect(mem.size).toBe(3);
    expect(mem.list().map((entry) => entry.task)).toEqual(
      expect.arrayContaining(["task 1", "task 2", "task 3"]),
    );
  });

  it("keeps the cap when two inserts overlap at the ceiling", async () => {
    const mem = new EpisodicMemory({ maxEntries: 2, now: () => 1_000 });
    const experience = (task: string) => ({
      task,
      framework: "",
      model: "",
      success: true,
      keyActions: [] as string[],
      lessons: task,
      workspaceTag: "",
    });
    await mem.recordExperience(experience("a"));
    await mem.recordExperience(experience("b"));
    await Promise.all([mem.recordExperience(experience("c")), mem.recordExperience(experience("d"))]);
    expect(mem.size).toBe(2);
  });
});
