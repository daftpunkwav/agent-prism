/**
 * @file autogen live bridge test
 * @description Runs the REAL `python/bootstrap.py` through the real host bridge
 *              against a scripted host model (no provider credentials involved).
 *
 * Responsibilities:
 * - Pin the live integration: the real autogen RoundRobinGroupChat drives the
 *   frozen NDJSON protocol, the host model answers through a scripted LlmAdapter,
 *   and a tool call round-trips through the arena registry
 * - Pin the arena prompt assembly on the live path: the host model receives the
 *   arena system prompt merged in front of the framework's role copy, plus the
 *   column's history on the first request
 * - Pin that the bootstrap script resolves to a file that exists (the path bug
 *   that made the bridge spawn a missing script is covered below)
 *
 * Skips itself when no interpreter can import `autogen_agentchat`, so the suite
 * stays green on a machine without the framework. The fake-bootstrap test covers
 * the protocol plumbing unconditionally; this one covers the real framework.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArenaEvent, LlmAdapter, LlmCallOptions, LlmMessage, ToolDefinition } from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import { RagStoreCache, buildSystemUser, createContextAnalytics, type AgentExecutionContext } from "@agentprism/harness";
import { MapToolRegistry } from "@agentprism/tool-registry";
import { TokenTracker } from "@agentprism/telemetry";
import { SystemClock, WorkspaceRegistry } from "@agentprism/runtime";
import { bootstrapScriptPath, runAutogenFrameworkBridge } from "../src/autogen-bridge.js";

/** Resolves the interpreter that can import the framework, or null (same preference order as the runtime probe). */
function liveInterpreter(): string | null {
  const override = process.env["ARENA_PYTHON"]?.trim();
  const candidates = override !== undefined && override !== "" ? [override] : ["python", "python3"];
  for (const interpreter of candidates) {
    try {
      execFileSync(interpreter, ["-c", "import autogen_agentchat"], { timeout: 60_000, stdio: "ignore" });
      return interpreter;
    } catch {
      // not this one
    }
  }
  return null;
}

const interpreter = liveInterpreter();

describe("bootstrapScriptPath", { retry: 1 }, () => {
  it("resolves to the package's bundled bootstrap that really exists", () => {
    // The suffix alone is not the contract: the bug this pins resolved to
    // <package>/../python/bootstrap.py, a path no install ever has.
    const script = bootstrapScriptPath(import.meta.url);
    expect(existsSync(script)).toBe(true);
    expect(script.replaceAll("\\", "/")).toMatch(/driver-autogen\/python\/bootstrap\.py$/);
  });
});

describe.skipIf(interpreter === null)("runAutogenFrameworkBridge against the real framework", { retry: 1 }, () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  /** Scripted host model: the coder reads once then answers; the reviewer terminates. */
  function scriptedModel(calls: Array<{ messages: LlmMessage[]; tools: string[] }>): LlmAdapter {
    let coderTurns = 0;
    return {
      invoke: async (messages: LlmMessage[], options?: LlmCallOptions) => {
        calls.push({ messages: [...messages], tools: (options?.tools ?? []).map((tool) => tool.name) });
        // The wire carries no speaker id, but the agent's own system turn does:
        // that is how a scripted stub answers per role.
        const asking = messages
          .filter((message) => message.role === "system")
          .map((message) => message.content)
          .join("\n");
        if (asking.includes("[AutoGen reviewer]")) {
          return { text: "TERMINATE: verified", toolCalls: [], usage: { input_tokens: 30, output_tokens: 4 } };
        }
        coderTurns += 1;
        if (coderTurns === 1) {
          return {
            text: "checking the note",
            toolCalls: [{ id: "c1", name: "read", args: { path: "note.txt" } }],
            usage: { input_tokens: 25, output_tokens: 8 },
          };
        }
        return { text: "final answer: note-read-ok", toolCalls: [], usage: { input_tokens: 40, output_tokens: 9 } };
      },
      async *stream() {},
    };
  }

  async function runLive(): Promise<{ events: ArenaEvent[]; context: AgentExecutionContext; calls: Array<{ messages: LlmMessage[]; tools: string[] }> }> {
    const calls: Array<{ messages: LlmMessage[]; tools: string[] }> = [];
    const registry = new MapToolRegistry();
    registry.register({
      name: "read",
      description: "read a file",
      jsonSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      mutatesWorkspace: false,
      execute: async () => ({ result: "note body from the workspace", fileDiff: null, ok: true }),
    } as ToolDefinition);
    const names = new Set(["read"]);
    const runsRoot = mkdtempSync(join(tmpdir(), "autogen-live-"));
    cleanups.push(() => rmSync(runsRoot, { recursive: true, force: true }));
    const workspace = new WorkspaceRegistry({ runsRoot, clock: { now: () => 1_700_000_000_000 } }).create("ws");
    const context = {
      identity: { agentId: "a", runId: "r" },
      config: PipelineConfigSchema.parse({ label: "live", harness: "bare", max_steps: 8 }),
      question: "read note.txt and report its content",
      history: [{ role: "user", content: "earlier question" }],
      turn: 2,
      workspace,
      tracker: new TokenTracker(),
      clock: new SystemClock(),
      rag: new RagStoreCache(),
      llm: scriptedModel(calls),
      llmVendor: null,
      contextAnalytics: createContextAnalytics(),
      tools: {
        registry,
        names,
        execute: (name: string, args: Record<string, unknown>) =>
          registry.execute(workspace, name, args, { authorizedNames: names }),
      },
    } as unknown as AgentExecutionContext;

    const events: ArenaEvent[] = [];
    for await (const event of runAutogenFrameworkBridge({
      context,
      interpreter: interpreter as string,
      bootstrapPath: bootstrapScriptPath(import.meta.url),
    })) {
      events.push(event);
    }
    return { events, context, calls };
  }

  it("drives a real group chat to a complete answer with a tool round-trip", { timeout: 180_000 }, async () => {
    const { events, calls } = await runLive();

    // The real framework ran to completion.
    const terminal = events.at(-1);
    expect(terminal?.type).toBe("complete");
    expect(terminal?.metrics?.success).toBe(true);
    expect(events.some((event) => event.type === "error")).toBe(false);

    // Tool round trip: arena definition → framework BridgeTool → NDJSON → host.
    expect(events.some((event) => event.type === "action" && event.tool === "read")).toBe(true);
    expect(
      events.some((event) => event.type === "observation" && event.result.includes("note body from the workspace")),
    ).toBe(true);

    // The coder reflected on the tool result and its answer rode the thought
    // channel; the reviewer's verdict rides reflect. Three calls: tool turn,
    // reflection, reviewer.
    const thoughts = events.filter((event) => event.type === "thought").map((event) => event.content);
    expect(thoughts.some((content) => content.includes("final answer: note-read-ok"))).toBe(true);
    expect(events.some((event) => event.type === "reflect" && event.content.includes("TERMINATE: verified"))).toBe(true);
    expect(calls.length).toBe(3);
  });

  it("prepares every live completion on the arena prompt assembly", { timeout: 180_000 }, async () => {
    const { context, calls } = await runLive();
    const systemPrefix = buildSystemUser(context).system.slice(0, 40);

    for (const call of calls) {
      expect(call.messages[0]?.role).toBe("system");
      expect(call.messages[0]?.content).toContain(systemPrefix);
    }
    // History belongs to the conversation's first completion.
    expect(calls[0]?.messages.some((message) => message.content === "earlier question")).toBe(true);
    expect(calls[1]?.messages.some((message) => message.content === "earlier question")).toBe(false);
    // The coder's turns carry the tool catalog; the reflection asks for no tools
    // (autogen's tool_choice="none"), and the host withholds the schemas for it.
    expect(calls[0]?.tools).toContain("read");
    expect(calls[1]?.tools).toEqual([]);
    expect(calls[2]?.tools).toEqual([]);
    // The reflection sees the tool result as a real tool turn, not as assistant text.
    expect(calls[1]?.messages.some((message) => message.role === "tool" && message.content === "note body from the workspace")).toBe(true);
  });

  it("records the live model calls in the token ledger", { timeout: 180_000 }, async () => {
    const { events, calls } = await runLive();
    const terminal = events.at(-1);
    // Three scripted calls: coder tool turn (25/8), reflection (40/9), reviewer (30/4).
    expect(calls.length).toBe(3);
    expect(terminal?.token_stats?.input_tokens).toBe(95);
    expect(terminal?.token_stats?.output_tokens).toBe(21);
  });
});
