/**
 * @file session-query test
 * @description Locks the live session_query tool: list/read with caps, port failures loud.
 */
import { describe, expect, it } from "vitest";
import type { AgentExecutionContext } from "@agentprism/harness";
import type { ArenaEvent, SessionQueryPort } from "@agentprism/contracts";
import { collect, testDeps, testSpec } from "./run-fixtures.js";

function port(): SessionQueryPort {
  return {
    listSessions: async () => [
      { id: "s1", kind: "arena", title: "Prime race", status: "completed", createdAt: 1, updatedAt: 2, summary: "all passed", metadata: {}, entryCount: 1 },
      { id: "s2", kind: "agent", title: "Nightly", status: "active", createdAt: 3, updatedAt: 4, summary: null, metadata: {}, entryCount: 0 },
    ],
    getSession: async (id: string) => {
      if (id !== "s1") return null;
      return {
        record: { id: "s1", kind: "arena", title: "Prime race", status: "completed", createdAt: 1, updatedAt: 2, summary: "all passed", metadata: {}, entryCount: 1 },
        entries: [{ sessionId: "s1", seq: 0, at: 2, kind: "verdict", content: "PASS" }],
      };
    },
    readSessionBlob: async (id: string, seq: number) => {
      if (id === "s1" && seq === 7) return "line1\nline2\nline3";
      return null;
    },
  };
}

describe("runAgentExecution session_query tool", () => {
  it("lists and reads through the injected port", async () => {
    const results: string[] = [];
    const driver = {
      frameworkId: "stub",
      displayName: "Stub",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        results.push((await ctx.tools.execute("session_query", { action: "list" })).result);
        results.push((await ctx.tools.execute("session_query", { action: "read", id: "s1" })).result);
        results.push((await ctx.tools.execute("session_query", { action: "read", id: "nope" })).result);
        results.push((await ctx.tools.execute("session_query", { action: "bogus" })).result);
      },
    };
    await collect(testDeps(), testSpec(driver, { sessions: port() }));
    expect(results).toHaveLength(4);
    expect(results[0]).toContain("s1 [arena/completed] Prime race");
    expect(results[1]).toContain("PASS");
    expect(results[2]).toContain("unknown session");
    expect(results[3]).toContain("must be one of list, read, read_entry");
  });

  it("reads spilled blobs with paging and loud failures", async () => {
    const results: string[] = [];
    const driver = {
      frameworkId: "stub",
      displayName: "Stub",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        results.push((await ctx.tools.execute("session_query", { action: "read_entry", id: "s1", seq: 7 })).result);
        results.push((await ctx.tools.execute("session_query", { action: "read_entry", id: "s1", seq: 7, offset: 2, limit: 1 })).result);
        results.push((await ctx.tools.execute("session_query", { action: "read_entry", id: "s1", seq: 8 })).result);
        results.push((await ctx.tools.execute("session_query", { action: "read_entry", id: "s1" })).result);
        results.push((await ctx.tools.execute("session_query", { action: "read_entry" })).result);
      },
    };
    await collect(testDeps(), testSpec(driver, { sessions: port() }));
    expect(results).toHaveLength(5);
    expect(results[0]).toContain("# blob s1#7 [lines 1–3 of 3]");
    expect(results[0]).toContain("line1\nline2\nline3");
    expect(results[1]).toContain("[lines 2–2 of 3] (offset/limit to page)");
    expect(results[1]).toContain("line2");
    expect(results[1]).not.toContain("line1\n");
    expect(results[2]).toContain("unknown session/blob");
    expect(results[3]).toContain("needs a seq");
    expect(results[4]).toContain("needs an id");
  });

  it("reports unsupported blob reads when the port lacks them", async () => {
    const { readSessionBlob: _dropped, ...bare } = port();
    void _dropped;
    let outcome = "";
    const driver = {
      frameworkId: "stub",
      displayName: "Stub",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        outcome = (await ctx.tools.execute("session_query", { action: "read_entry", id: "s1", seq: 0 })).result;
      },
    };
    await collect(testDeps(), testSpec(driver, { sessions: bare }));
    expect(outcome).toContain("not supported by this runtime");
  });

  it("stays placeholder without a port", async () => {
    let outcome = "";
    const driver = {
      frameworkId: "stub",
      displayName: "Stub",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        outcome = (await ctx.tools.execute("session_query", { action: "list" })).result;
      },
    };
    await collect(testDeps(), testSpec(driver));
    expect(outcome).toContain("only available inside a live agent execution");
  });
});
