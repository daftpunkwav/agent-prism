/**
 * @file tool taxonomy tests
 * @description Covers the trace tool-name classification table.
 *
 * Responsibilities:
 * - Pin the tool-name-to-category mapping for every known tool
 * - Lock the contract that interactive, planning, network, and agent tools
 *   never classify as file operations
 */

import { describe, expect, it } from "vitest";
import { toolCategory } from "../src/app/arena/toolTaxonomy";

describe("toolCategory", () => {
  it("classifies file-read tools", () => {
    for (const tool of ["read", "ls", "glob", "grep", "symbols"]) {
      expect(toolCategory(tool)).toBe("read");
    }
  });

  it("classifies file-write tools", () => {
    for (const tool of ["write", "edit", "apply_patch"]) {
      expect(toolCategory(tool)).toBe("write");
    }
  });

  it("classifies code-execution tools", () => {
    for (const tool of ["bash", "run_job", "bash_session"]) {
      expect(toolCategory(tool)).toBe("code");
    }
  });

  it("classifies interactive, planning, network, and agent tools", () => {
    expect(toolCategory("ask_user")).toBe("ask");
    for (const tool of ["todo_write", "plan", "goal", "ralph_loop"]) {
      expect(toolCategory(tool)).toBe("plan");
    }
    // "webfetch" is the pre-rename name; old journals must keep classifying as net.
    for (const tool of ["web_fetch", "webfetch", "web_search"]) {
      expect(toolCategory(tool)).toBe("net");
    }
    for (const tool of ["subagent", "skill", "session_query", "scatter"]) {
      expect(toolCategory(tool)).toBe("agent");
    }
  });

  it("maps unknown tools to other", () => {
    expect(toolCategory("some_future_tool")).toBe("other");
  });

  it("never classifies interactive, planning, network, or agent tools as file ops", () => {
    for (const tool of ["ask_user", "todo_write", "web_fetch", "web_search", "subagent", "skill"]) {
      expect(["read", "write", "code"]).not.toContain(toolCategory(tool));
    }
  });
});
