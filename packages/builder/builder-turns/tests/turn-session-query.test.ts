/**
 * @file turn-session-query test
 * @description Locks session_query plumbing from builder turns into live tools.
 */
import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentDriver, ArenaEvent, SessionQueryPort } from "@agentprism/contracts";
import type { AgentExecutionContext } from "@agentprism/harness";
import { RandomIdGenerator, SystemClock, WorkspaceRegistry } from "@agentprism/runtime";
import { normalizeComposition } from "../src/composition.js";
import { runBuilderTurn } from "../src/turn-runner.js";

function port(): SessionQueryPort {
  return {
    listSessions: async () => [
      { id: "s9", kind: "arena", title: "Old race", status: "completed", createdAt: 1, updatedAt: 2, summary: null, metadata: {}, entryCount: 0 },
    ],
    getSession: async () => null,
  };
}

describe("runBuilderTurn session_query", () => {
  it("serves the tool from the injected port when composed", async () => {
    const clock = new SystemClock();
    const deps = {
      driverLookup: {
        listAvailable: () => [],
        listReserved: () => [],
        get: (): AgentDriver => ({
          frameworkId: "stub",
          displayName: "Stub",
          async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
            const outcome = await ctx.tools.execute("session_query", { action: "list" });
            // No turn field on purpose: stampEvent must backfill unannotated
            // driver events so turn scoping and answer extraction keep them.
            const event = { type: "thought", pipeline: "builder", workspace: ctx.workspace.name, content: outcome.result };
            delete (event as Record<string, unknown>).turn;
            yield event as unknown as ArenaEvent;
          },
        }),
      },
      modelRuntime: {
        create: () => ({
          llm: { invoke: async () => ({ text: "", toolCalls: [] }), stream: async function* () {} },
          llmVendor: null,
          contextWindow: 100000,
          maxInputTokens: 90000,
        }),
      },
      workspaceRegistry: new WorkspaceRegistry({ runsRoot: join(tmpdir(), `aprism-builder-sq-${randomUUID()}`), clock }),
      idGenerator: new RandomIdGenerator(),
      clock,
      sessionsQuery: port(),
    };
    const hooks = { appendTrace: (kind: string, title: string, data: Record<string, unknown>) => ({ kind, title, data }) as never };
    const composition = { ...normalizeComposition({}), tools: ["session_query"] };
    const iterator = runBuilderTurn(deps, hooks, {
      sessionId: "sess-1",
      turn: 1,
      message: "what ran before?",
      composition,
      history: [],
      thinkingCapable: false,
      notices: [],
    });
    let output: { answer: string; errorSeen: boolean } | null = null;
    const seen: string[] = [];
    for (;;) {
      const step = await iterator.next();
      if (step.done === true) {
        output = step.value as unknown as { answer: string; errorSeen: boolean };
        break;
      }
      const chunk = step.value as unknown as Record<string, unknown>;
      seen.push(`${String(chunk.stream)}:${JSON.stringify(chunk).slice(0, 160)}`);
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(output).not.toBeNull();
    expect(output!.errorSeen).toBe(false);
    expect(output!.answer).toContain("Old race");
  });
});
