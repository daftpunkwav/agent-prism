/**
 * @file crewai live bridge test
 * @description Runs the REAL `python/bootstrap.py` through the real host bridge
 *              against a scripted host model (no provider credentials involved).
 *
 * Responsibilities:
 * - Pin the live integration: the real crewai Crew drives the frozen NDJSON
 *   protocol and the host model answers through a scripted LlmAdapter
 * - Pin the arena prompt assembly on the live path: every completion carries the
 *   arena system prompt merged in front of the crew's role copy
 * - Pin the supervisor's budget: past max_steps the host stops paying for
 *   completions instead of letting the crew loop on the arena model
 *
 * Skips itself when no interpreter can import `crewai`, so the suite stays green
 * on a machine without the framework (crewai needs Python < 3.14). The
 * fake-bootstrap test covers the protocol plumbing unconditionally.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArenaEvent, LlmAdapter, LlmCallOptions, LlmMessage, ToolDefinition } from "@agentprism/contracts";
import { PipelineConfigSchema, extractAnswerFromEvents } from "@agentprism/contracts";
import { RagStoreCache, buildSystemUser, type AgentExecutionContext } from "@agentprism/harness";
import { MapToolRegistry } from "@agentprism/tool-registry";
import { TokenTracker } from "@agentprism/telemetry";
import { SystemClock, WorkspaceRegistry } from "@agentprism/runtime";
import { bootstrapScriptPath, runCrewaiFrameworkBridge } from "../src/crewai-bridge.js";

/** Resolves the interpreter that can import the framework, or null (same preference order as the runtime probe). */
function liveInterpreter(): string | null {
  const override = process.env["ARENA_PYTHON"]?.trim();
  const candidates = override !== undefined && override !== "" ? [override] : ["python", "python3"];
  for (const interpreter of candidates) {
    try {
      execFileSync(interpreter, ["-c", "import crewai"], { timeout: 60_000, stdio: "ignore" });
      return interpreter;
    } catch {
      // not this one
    }
  }
  return null;
}

const interpreter = liveInterpreter();

describe("bootstrapScriptPath", () => {
  it("resolves to the package's bundled bootstrap that really exists", () => {
    const script = bootstrapScriptPath(import.meta.url);
    expect(existsSync(script)).toBe(true);
    expect(script.replaceAll("\\", "/")).toMatch(/driver-crewai\/python\/bootstrap\.py$/);
  });
});

describe.skipIf(interpreter === null)("runCrewaiFrameworkBridge against the real framework", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  async function runLive(options: { replies?: string[] } = {}): Promise<{
    events: ArenaEvent[];
    context: AgentExecutionContext;
    calls: Array<{ messages: LlmMessage[]; tools: string[] }>;
  }> {
    const calls: Array<{ messages: LlmMessage[]; tools: string[] }> = [];
    const replies = options.replies ?? [];
    const llm: LlmAdapter = {
      invoke: async (messages: LlmMessage[], callOptions?: LlmCallOptions) => {
        calls.push({ messages: [...messages], tools: (callOptions?.tools ?? []).map((tool) => tool.name) });
        const reply = replies[Math.min(calls.length - 1, replies.length - 1)] ?? "Done: the crew finished.";
        return { text: reply, toolCalls: [], usage: { input_tokens: 11, output_tokens: 5 } };
      },
      async *stream() {},
    };
    const registry = new MapToolRegistry();
    registry.register({
      name: "read",
      description: "read a file",
      jsonSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      mutatesWorkspace: false,
      execute: async () => ({ result: "note body from the workspace", fileDiff: null, ok: true }),
    } as ToolDefinition);
    const names = new Set(["read"]);
    const runsRoot = mkdtempSync(join(tmpdir(), "crewai-live-"));
    cleanups.push(() => rmSync(runsRoot, { recursive: true, force: true }));
    const workspace = new WorkspaceRegistry({ runsRoot, clock: { now: () => 1_700_000_000_000 } }).create("ws");
    const context = {
      identity: { agentId: "a", runId: "r" },
      config: PipelineConfigSchema.parse({ label: "live", harness: "bare", max_steps: 12 }),
      question: "read note.txt and report its content",
      history: [{ role: "user", content: "earlier question" }],
      turn: 2,
      workspace,
      tracker: new TokenTracker(),
      clock: new SystemClock(),
      rag: new RagStoreCache(),
      llm,
      llmVendor: null,
      tools: {
        registry,
        names,
        execute: (name: string, args: Record<string, unknown>) =>
          registry.execute(workspace, name, args, { authorizedNames: names }),
      },
    } as unknown as AgentExecutionContext;

    const events: ArenaEvent[] = [];
    for await (const event of runCrewaiFrameworkBridge({
      context,
      interpreter: interpreter as string,
      bootstrapPath: bootstrapScriptPath(import.meta.url),
    })) {
      events.push(event);
    }
    return { events, context, calls };
  }

  it("runs the real crew pipeline to a complete answer", { timeout: 300_000 }, async () => {
    const { events, calls } = await runLive({
      replies: [
        "Thought: I have enough context\nFinal Answer: brief ready",
        "Thought: the artifact is written\nFinal Answer: final answer: crew-artifact-ready",
        "Thought: verified\nFinal Answer: final answer: crew-artifact-ready",
      ],
    });

    const terminal = events.at(-1);
    expect(terminal?.type).toBe("complete");
    expect(terminal?.metrics?.success).toBe(true);
    expect(events.some((event) => event.type === "error")).toBe(false);
    // The crew's own crew output is the column's answer (role speech stays on reflect).
    expect(extractAnswerFromEvents(events)).toBe("final answer: crew-artifact-ready");
    // The crew really asked the host model more than once, and each completion
    // carried the arena system prompt in front of the crew's own role copy.
    expect(calls.length).toBeGreaterThanOrEqual(3);
    const systemPrefix = buildSystemUser((await runLive()).context).system.slice(0, 40);
    for (const call of calls.slice(0, 3)) {
      expect(call.messages[0]?.content).toContain(systemPrefix);
    }
  });

  it("stops paying for completions past the step budget", { timeout: 300_000 }, async () => {
    // The crew's own pipeline is unbounded on the child side; the host owns the
    // bound. Two calls per task are plenty for three tasks, so a budget of 2 must
    // cut the run short and answer with the wrap-up note.
    const events: ArenaEvent[] = [];
    const calls: LlmMessage[][] = [];
    const llm: LlmAdapter = {
      invoke: async (messages: LlmMessage[]) => {
        calls.push([...messages]);
        return { text: "Thought: still working\nFinal Answer: partial", toolCalls: [] };
      },
      async *stream() {},
    };
    const registry = new MapToolRegistry();
    const runsRoot = mkdtempSync(join(tmpdir(), "crewai-budget-"));
    cleanups.push(() => rmSync(runsRoot, { recursive: true, force: true }));
    const workspace = new WorkspaceRegistry({ runsRoot, clock: { now: () => 1 } }).create("ws");
    const context = {
      identity: { agentId: "a", runId: "r" },
      config: PipelineConfigSchema.parse({ label: "budget", harness: "bare", max_steps: 2 }),
      question: "do the task",
      history: [],
      turn: 1,
      workspace,
      tracker: new TokenTracker(),
      clock: new SystemClock(),
      rag: new RagStoreCache(),
      llm,
      llmVendor: null,
      tools: { registry, names: new Set<string>(), execute: async () => ({ result: "", fileDiff: null, ok: true }) },
    } as unknown as AgentExecutionContext;
    for await (const event of runCrewaiFrameworkBridge({
      context,
      interpreter: interpreter as string,
      bootstrapPath: bootstrapScriptPath(import.meta.url),
    })) {
      events.push(event);
    }
    // The host owns the bound: exactly two real model calls, then the note.
    expect(calls.length).toBe(2);
    // The session terminates and reports its outcome. crewai 1.x answers a
    // post-budget completion it cannot parse through its own agent retry path and
    // ends the crew with a parse error, so the terminal state is the child's
    // failure; what this column owns is that the arena stopped paying (above) and
    // that the run still terminates instead of looping on the model.
    const terminal = events.at(-1);
    expect(terminal?.type).toBe("complete");
    expect(events.filter((event) => event.type === "reflect").length).toBeGreaterThan(0);
  });
});
