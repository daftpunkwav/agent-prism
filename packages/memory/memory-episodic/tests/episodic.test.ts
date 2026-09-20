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
      keyActions: ["run", "read"],
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
        keyActions: ["run"],
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
      keyActions: ["run"],
      lessons: "use node",
      workspaceTag: "",
    };
    await mem.recordExperience(base);
    await mem.recordExperience({ ...base, keyActions: ["read"] });
    expect(mem.size).toBe(1);
    expect(mem.list()[0]?.keyActions.sort()).toEqual(["read", "run"]);
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
      keyActions: ["run"],
      lessons: "use node",
      workspaceTag: "",
    });
    await mem.recordExperience({
      task: "run factorial script", // same normalized task, same outcome+lessons
      framework: "native",
      model: "test",
      success: true,
      keyActions: ["run", "read"], // new action folds into the merged entry
      lessons: "use node",
      workspaceTag: "ws-2",
    });
    expect(mem.size).toBe(1);
    const [merged] = await mem.recallExperiences("factorial", { limit: 1 });
    expect(merged?.keyActions).toEqual(["run", "read"]);
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
