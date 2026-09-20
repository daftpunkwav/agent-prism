/**
 * @file workspace naming tests
 * @description Locks run-workspace name sanitization: traversal-safe, bounded, dot-clean.
 */

import { describe, expect, it } from "vitest";
import { newWorkspaceName } from "../src/run-workspace.js";

describe("newWorkspaceName sanitization", () => {
  it("labels with traversal segments do not produce path separators", () => {
    for (const label of ["../../evil", "a/b\\c", "..", "...", "normal-label-01", "LangChain(current)"]) {
      const name = newWorkspaceName(label);
      expect(name).not.toMatch(/[/\\]/);
      expect(name.length).toBeLessThanOrEqual(90);
    }
  });

  it("falls back to workspace when label sanitizes to empty", () => {
    expect(newWorkspaceName("../..").startsWith("workspace_")).toBe(true);
    expect(newWorkspaceName("///").startsWith("workspace_")).toBe(true);
  });

  it("truncation does not leave a trailing dot (Windows trailing-dot strip drift)", () => {
    const name = newWorkspaceName(`${"a".repeat(63)}.`);
    const namePart = name.split("_")[0] ?? "";
    expect(namePart).toBe("a".repeat(63)); // trailing dot cleaned twice, keeps 63 a's
  });
});
