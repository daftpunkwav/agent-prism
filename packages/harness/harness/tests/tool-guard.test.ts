/**
 * @file toolset guard tests
 * @description Keeps the toolset source and guard aligned.
 *
 * Responsibilities:
 * - Match the guard's tool names against the real registry entries
 * - Pin relevance assessment: unknown toolsets fail closed, drift checks, legacy names dropped
 */

import { describe, expect, it } from "vitest";
import { TOOL_NAMES_BY_TOOLSET } from "@agentprism/contracts";
import { normalizeToolset, resolveToolsetId, selectToolNames } from "@agentprism/tool-registry";
import { assessToolRelevance, blockedToolMessageContent } from "@agentprism/harness";

describe("toolset single source of truth", () => {
  it("toolset is derived from contracts with stable sort", () => {
    expect(selectToolNames("full")).toEqual(["apply_patch", "ask_user", "bash", "bash_session", "edit", "glob", "goal", "grep", "ls", "plan", "ralph_loop", "read", "run_job", "scatter", "session_query", "skill", "subagent", "symbols", "todo_write", "web_search", "webfetch", "write"]);
    expect(selectToolNames("read_only")).toEqual(["glob", "grep", "ls", "ralph_loop", "read", "scatter", "session_query", "skill", "subagent", "symbols"]);
    expect(Object.keys(TOOL_NAMES_BY_TOOLSET)).toEqual(["full", "edit_run", "read_only"]);
  });

  it("unknown toolsets fail closed: strictest set, not silent upgrade to full", () => {
    expect(normalizeToolset("READ_ONLY")).toBe("read_only");
    expect(normalizeToolset("read-only")).toBe("read_only");
    expect(resolveToolsetId("readonly")).toBe("read_only");
    // Valid values and legacy aliases are unaffected
    expect(normalizeToolset("full")).toBe("full");
    expect(resolveToolsetId("code_file")).toBe("edit_run");
    expect(resolveToolsetId(undefined)).toBe("full");
  });
});

describe("tool guard aligns with real tool names", () => {
  const unrelated = { path: "notes.txt", content: "x".repeat(200) };
  // CJK weather question (Unicode-escaped): 2-grams do not collide with JSON arg keys.
  const weatherQ = "\u4eca\u5929\u5929\u6c14\u5982\u4f55";

  it("time-like questions are no longer unconditionally blocked (get_current_time branch removed)", () => {
    const verdict = assessToolRelevance("What time is it now?", "bash", { command: "date" }, []);
    expect(verdict.allowed).toBe(true);
  });

  it("latin questions with unrelated writes enter drift-guard checks", () => {
    const blocked = assessToolRelevance("What is the weather like today outside?", "write", unrelated, ["read"]);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("write");
  });

  it("pure-CJK questions are exempt from drift blocking (no latin anchor to score)", () => {
    // Regression: a Chinese task writing English code scored overlap ~0 and was
    // blocked on every call, so the Builder could never create source files.
    const verdict = assessToolRelevance(weatherQ, "write", unrelated, ["read"]);
    expect(verdict.allowed).toBe(true);
  });

  it("writes containing todo markers are no longer keyword-blocked", () => {
    const todoWrite = { path: "game.js", content: "// TODO: polish".repeat(30) };
    const verdict = assessToolRelevance("create a mario game", "write", todoWrite, ["read"]);
    expect(verdict.allowed).toBe(true);
  });

  it("file-needed questions allow write tools", () => {
    const verdict = assessToolRelevance("Please save the result as a txt file", "write", unrelated, ["read"]);
    expect(verdict.allowed).toBe(true);
  });

  it("legacy virtual tool names are no longer recognized by the guard", () => {
    const verdict = assessToolRelevance(weatherQ, "write_file", unrelated, ["read"]);
    expect(verdict.allowed).toBe(true);
  });
});

describe("blockedToolMessageContent harness gate", () => {
  const question = "What is the weather like today outside?";
  const args = { path: "notes.txt", content: "x".repeat(200) };

  it("blocks unrelated writes when the harness guard is active", () => {
    expect(blockedToolMessageContent(question, "write", args, ["read"], "verify")).not.toBeNull();
    expect(blockedToolMessageContent(question, "write", args, ["read"], "reflect")).not.toBeNull();
    expect(blockedToolMessageContent(question, "write", args, ["read"])).not.toBeNull();
  });

  it("bare harness disables the guard entirely (builder default)", () => {
    expect(blockedToolMessageContent(question, "write", args, ["read"], "bare")).toBeNull();
    expect(blockedToolMessageContent("随便写点什么", "write", args, ["read"], "bare")).toBeNull();
  });
});
