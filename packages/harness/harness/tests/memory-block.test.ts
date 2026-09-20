/**
 * @file memory-block tests
 * @description Locks renderMemoryBlock formatting and assembly gating.
 */

import { describe, expect, it } from "vitest";
import { renderMemoryBlock } from "../src/prompt/assembly.js";

describe("renderMemoryBlock", () => {
  it("returns empty for missing or empty recall", () => {
    expect(renderMemoryBlock(undefined)).toBe("");
    expect(renderMemoryBlock(null)).toBe("");
    expect(renderMemoryBlock({ episodic: [], semantic: [] })).toBe("");
  });

  it("renders episodic outcomes and semantic conventions", () => {
    const block = renderMemoryBlock({
      episodic: [
        {
          id: "ep-1",
          task: "run factorial script",
          framework: "native",
          model: "m",
          success: true,
          keyActions: ["run", "read"],
          lessons: "try node instead of python",
          timestamp: 1,
          workspaceTag: "",
        },
      ],
      semantic: [{ id: "sem-1", subject: "project", predicate: "uses", object: "vitest", confidence: 1, validFrom: 0, source: "" }],
    });
    expect(block).toContain("[Prior Experience & Relevant Memories]");
    expect(block).toContain("succeeded");
    expect(block).toContain("try node instead of python");
    expect(block).toContain("Project convention: project uses vitest.");
  });

  it("caps lines and truncates verbose lessons", () => {
    const block = renderMemoryBlock({
      episodic: Array.from({ length: 10 }, (_, i) => ({
        id: `ep-${i}`,
        task: `task ${i}`,
        framework: "",
        model: "",
        success: false,
        keyActions: [],
        lessons: "x".repeat(500),
        timestamp: i,
        workspaceTag: "",
      })),
      semantic: [],
    });
    expect(block.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(3);
    expect(block.length).toBeLessThan(3 * 320 + 100);
  });
});
