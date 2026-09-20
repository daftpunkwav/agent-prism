/**
 * @file composition swap tests
 * @description Locks field/tool diffing and hot-swap notice rendering.
 */

import { describe, expect, it } from "vitest";
import type { BuilderComposition } from "@agentprism/contracts";
import { buildSwapNotice, diffComposition, normalizeComposition } from "../src/composition.js";

function baseComposition(overrides: Partial<BuilderComposition> = {}): BuilderComposition {
  return { ...normalizeComposition({}), ...overrides };
}

describe("diffComposition / buildSwapNotice", () => {
  it("reports field and tool-level changes", () => {
    const before = baseComposition({ tools: ["read", "grep"], framework: "native" });
    const after = baseComposition({ tools: ["read", "write"], framework: "langchain" });
    const diff = diffComposition(before, after);
    expect(diff.changedFields).toContain("tools");
    expect(diff.changedFields).toContain("framework");
    expect(diff.toolsAdded).toEqual(["write"]);
    expect(diff.toolsRemoved).toEqual(["grep"]);
    const notice = buildSwapNotice(diff, after);
    expect(notice).toContain("+write");
    expect(notice).toContain("-grep");
    expect(notice).toContain("read, write");
  });

  it("returns null for identical compositions", () => {
    const same = baseComposition();
    expect(buildSwapNotice(diffComposition(same, { ...same }), same)).toBeNull();
  });
});

