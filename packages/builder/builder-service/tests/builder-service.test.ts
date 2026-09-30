/**
 * @file builder-service.test
 * @description Integration tests for BuilderService over fake drivers.
 *
 * Responsibilities:
 * - Pin the chat-turn chunk flow, history persistence, hot-swap notices, and guards
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  AgentDriver,
  ArenaEvent,
  BuilderStreamChunk,
  DriverLookup,
  PipelineMetrics,
  ToolExecutionResult,
} from "@agentprism/contracts";
import { registerCustomDimensions, type AgentExecutionContext } from "@agentprism/harness";
import { BuilderCreateRequestSchema, BuilderPatchRequestSchema, completeEvent } from "@agentprism/contracts";
import { WorkspaceRegistry } from "@agentprism/runtime";
import { BuilderService } from "../src/builder-service.js";
import { SessionTraceStore } from "../src/session-trace-store.js";
import type { AppendFile } from "@agentprism/persistence";
import { SessionService } from "@agentprism/application";
import { InMemorySessionStore } from "@agentprism/session";
import { BuilderError } from "@agentprism/builder-turns";
import type { BuilderCustomBlock } from "@agentprism/builder-turns";
import { createBuiltinToolRegistry } from "@agentprism/tool-builtins";
import { BuilderSessionStore } from "../src/builder-session-store.js";
import type { BuilderModelRuntimeFactory } from "@agentprism/builder-turns";

/** Full metrics literal (schema defaults keep it stable across additions). */
const METRICS: PipelineMetrics = {
  success: true,
  duration_ms: 5,
  input_tokens: 10,
  output_tokens: 5,
  total_tokens: 15,
  tool_calls: 0,
  steps: 1,
  context_window: 128_000,
  max_input_tokens: 120_000,
  max_output_tokens: 2048,
  context_usage_pct: 0,
  input_usage_pct: 0,
};

function thoughtEvent(content: string): ArenaEvent {
  return {
    type: "thought",
    pipeline: "builder",
    workspace: "",
    content,
    tool: "",
    args: {},
    result: "",
    step: 1,
    passed: null,
    reason: "",
    metrics: null,
    message: "",
    token_stats: null,
    turn: 0,
    runId: "",
    timestamp: 0,
  };
}

interface DriverHarness {
  lookup: DriverLookup;
  /** Resolves once the driver has consumed its context; resolves with the context. */
  contexts: AgentExecutionContext[];
  /** Gate: blocks the driver's completion until released (concurrency tests). */
  gate: Promise<void>;
  release: () => void;
}

function makeDriverHarness(
  frameworkIds: string[],
  options: { block?: boolean; script?: ArenaEvent[] } = {},
): DriverHarness {
  const block = options.block ?? false;
  const script = options.script;
  const contexts: AgentExecutionContext[] = [];
  let releaseGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const drivers = new Map<string, AgentDriver>(
    frameworkIds.map((id) => [
      id,
      {
        frameworkId: id,
        displayName: id,
        async *run(context: AgentExecutionContext) {
          contexts.push(context);
          if (script !== undefined) {
            yield* script;
          } else {
            yield thoughtEvent(`Hello from ${id}`);
          }
          // Blocked so concurrency guards can be asserted while a turn is live.
          if (block) await gate;
          yield completeEvent({
            pipeline: "builder",
            workspace: context.workspace.name,
            metrics: METRICS,
            turn: context.turn,
            runId: context.identity.runId,
            agentId: context.identity.agentId,
            timestamp: 0,
          });
        },
      } satisfies AgentDriver,
    ]),
  );
  return {
    contexts,
    gate,
    release: releaseGate,
    lookup: {
      get: (id: string) => {
        const driver = drivers.get(id);
        if (driver === undefined) throw new Error(`no driver ${id}`);
        return driver;
      },
      listAvailable: () => [...drivers.keys()].map((id) => ({ id, name: id, status: "available" as const })),
      listReserved: () => [{ id: "crewai", name: "CrewAI", status: "reserved" as const }],
    },
  };
}

const modelRuntime: BuilderModelRuntimeFactory = {
  create: (config) => ({
    llm: {
      async *stream() {
        yield { text: "unused" };
      },
      async invoke() {
        return { text: "unused", toolCalls: [] };
      },
    },
    llmVendor: { config },
    contextWindow: 128_000,
    maxInputTokens: 120_000,
  }),
};

/** Real execution ledger over an ephemeral store (integration, not a fake). */
function makeSessionLedger(): SessionService {
  let seq = 0;
  return new SessionService({
    store: new InMemorySessionStore({
      idGenerator: { next: () => `ledger-${++seq}` },
      clock: { now: () => 1_790_000_000_000 },
    }),
  });
}

/** In-memory append-only line file (no disk in unit tests). */
class MemoryAppendFile implements AppendFile {
  private lines: string[] = [];
  async append(additions: string[]): Promise<void> {
    this.lines.push(...additions);
  }
  async readLines(): Promise<string[]> {
    return [...this.lines];
  }
  async rewrite(replacement: string[]): Promise<void> {
    this.lines = [...replacement];
  }
}

/** Registered custom-dimension blocks, as the composition root injects them. */
function axisOne(): BuilderCustomBlock {
  return {
    id: "probe_axis",
    label: "Probe axis",
    subtitle: "Probe axis subtitle",
    default: "high",
    options: [
      { value: "low", label: "Low", description: "" },
      { value: "high", label: "High", description: "" },
    ],
  };
}

function axisTwo(): BuilderCustomBlock {
  return {
    id: "probe_second",
    label: "Probe second",
    subtitle: "",
    default: "two",
    options: [
      { value: "one", label: "One", description: "" },
      { value: "two", label: "Two", description: "" },
    ],
  };
}

// The composition root registers the packages once and injects the same rows into
// the service: the run assembly resolves `config.custom` against this registry, so
// the fixture must be registered here too (a deps-only stub would fail the turn).
registerCustomDimensions([axisOne(), axisTwo()]);

function makeService(
  harness: Pick<DriverHarness, "lookup">,
  sessions: SessionService = makeSessionLedger(),
  runtime: BuilderModelRuntimeFactory = modelRuntime,
  customDimensions: readonly BuilderCustomBlock[] = [],
): BuilderService {
  const runsRoot = mkdtempSync(join(tmpdir(), "builder-service-test-"));
  const traceFiles = new Map<string, MemoryAppendFile>();
  return new BuilderService({
    store: new BuilderSessionStore({
      file: {
        read: () => null,
        async write() {},
      },
      idGenerator: { next: (() => {
        let n = 0;
        return () => `id-${(n += 1).toString(16)}`;
      })() },
      clock: { now: () => 1_790_000_000_000 },
    }),
    traceStore: new SessionTraceStore({
      open: (sessionId) => {
        let file = traceFiles.get(sessionId);
        if (file === undefined) {
          file = new MemoryAppendFile();
          traceFiles.set(sessionId, file);
        }
        return file;
      },
      flushDebounceMs: 1,
    }),
    driverLookup: harness.lookup,
    modelRuntime: runtime,
    workspaceRegistry: new WorkspaceRegistry({ runsRoot, clock: { now: () => 0 } }),
    idGenerator: { next: (() => {
      let n = 100;
      return () => `run-${(n += 1).toString(16)}`;
    })() },
    clock: { now: () => 1_790_000_000_000 },
    endpoints: () => [{ id: "ep1", name: "MiniMax", model: "abab", api_format: "openai_chat", thinking_capable: true, default: true }],
    // Real builtin surface: composition validation must see ask_user & co.
    toolDefinitions: () => createBuiltinToolRegistry().listDefinitions(),
    // Registered custom-dimension packages, injected at the composition root.
    customDimensions: () => customDimensions,
    resolveThinkingCapable: () => true,
    sessions,
  });
}

async function collect(generator: AsyncGenerator<BuilderStreamChunk>): Promise<{ chunks: BuilderStreamChunk[]; result: unknown }> {
  const chunks: BuilderStreamChunk[] = [];
  while (true) {
    const next = await generator.next();
    if (next.done) return { chunks, result: next.value };
    chunks.push(next.value);
  }
}

describe("BuilderService.chatTurn", () => {
  it("streams events, completes the turn, and persists history", async () => {
    const harness = makeDriverHarness(["fake"], { block: true });
    const service = makeService(harness);
    const view = service.createSession(BuilderCreateRequestSchema.parse({ name: "A", composition: { framework: "fake" } }));
    harness.release();

    const { chunks } = await collect(service.chatTurn(view.id, "hello"));
    const streams = chunks.map((chunk) => chunk.stream);
    expect(streams[0]).toBe("trace");
    expect(streams).toContain("event");
    expect(streams.at(-1)).toBe("turn");

    const detail = await service.getSessionDetail(view.id);
    expect(detail.session.turn_count).toBe(1);
    expect(detail.session.history).toEqual([
      { role: "user", content: "hello", turn: 1 },
      { role: "assistant", content: "Hello from fake", turn: 1 },
    ]);
    // The journal records the turn marker, the streamed arena events, and trace entries.
    expect(detail.records.some((record) => record.kind === "turn" && record.user === "hello")).toBe(true);
    expect(detail.records.some((record) => record.kind === "event")).toBe(true);
    // An ordinary session sits far below the detail tail cap: no truncation flag.
    expect(detail.truncated).toBe(false);
    const kinds = detail.records.filter((record) => record.kind === "trace").map((record) => record.entry.kind);
    expect(kinds).toContain("session");
  });

  it("delivers hot-swap notices to the next turn's driver context", async () => {
    const harness = makeDriverHarness(["fake", "other"], { block: false });
    const service = makeService(harness);
    const view = service.createSession(BuilderCreateRequestSchema.parse({ name: "B", composition: { framework: "fake" } }));

    harness.release();
    await collect(service.chatTurn(view.id, "first"));

    const swap = service.patchComposition(
      view.id,
      BuilderPatchRequestSchema.parse({ composition: { framework: "other", tools: ["web_fetch", "session_query"] } }),
    );
    expect(swap.changed_fields).toContain("framework");
    expect(swap.tools_added).toEqual(["web_fetch", "session_query"]);
    // Trace records the swap event.
    const swapDetail = await service.getSessionDetail(view.id);
    expect(swapDetail.records.some((record) => record.kind === "trace" && record.entry.kind === "swap")).toBe(true);

    await collect(service.chatTurn(view.id, "second"));
    const context = harness.contexts.at(-1);
    expect(context?.notices?.join(" ")).toMatch(/hot-swapped/i);
    expect(context?.notices?.join(" ")).toMatch(/-read|\+web_fetch/);
    expect([...(context?.tools.names ?? [])]).toEqual(["session_query", "web_fetch"]);
  });

  it("defaults omitted tools to the working set while explicit [] stays tool-free", async () => {
    const harness = makeDriverHarness(["fake"], { block: false });
    const service = makeService(harness);
    const view = service.createSession(BuilderCreateRequestSchema.parse({ composition: { framework: "fake" } }));
    const detail = await service.getSessionDetail(view.id);
    for (const name of ["read", "write", "edit", "ls", "bash", "glob", "grep", "todo_write", "ask_user"]) {
      expect(detail.session.composition.tools).toContain(name);
    }
    const bare = service.createSession(
      BuilderCreateRequestSchema.parse({ composition: { framework: "fake", tools: [] } }),
    );
    expect((await service.getSessionDetail(bare.id)).session.composition.tools).toEqual([]);
  });

  it("injects the no-tools notice for an empty tool selection", async () => {
    const harness = makeDriverHarness(["fake"], { block: true });
    const service = makeService(harness);
    const view = service.createSession(
      BuilderCreateRequestSchema.parse({ composition: { framework: "fake", tools: [] } }),
    );
    harness.release();
    await collect(service.chatTurn(view.id, "hello"));
    expect(harness.contexts[0]?.notices?.join(" ")).toMatch(/tool system is disabled/i);
  });

  it("passes the custom system prompt override to the driver", async () => {
    const harness = makeDriverHarness(["fake"], { block: true });
    const service = makeService(harness);
    const view = service.createSession(
      BuilderCreateRequestSchema.parse({ composition: { framework: "fake", system_prompt: "You are a pirate." } }),
    );
    harness.release();
    await collect(service.chatTurn(view.id, "hello"));
    expect(harness.contexts[0]?.systemPromptOverride).toBe("You are a pirate.");
  });

  it("advertises each registered dimension as a palette block", () => {
    const service = makeService(makeDriverHarness(["fake"]), makeSessionLedger(), modelRuntime, [
      axisOne(),
      axisTwo(),
    ]);
    const capabilities = service.catalog().capabilities;
    const block = capabilities.find((entry) => entry.block === "custom:probe_axis");
    // Display and execution agree: the block carries the descriptor copy and the
    // effective default the run applies when the composition holds no choice.
    expect(block?.label).toBe("Probe axis");
    expect(block?.default).toBe("high");
    expect(block?.options.map((option) => option.value)).toEqual(["low", "high"]);
    // Builtin slots are untouched by the custom projection.
    expect(capabilities.find((entry) => entry.block === "context")?.default).toBe("");
    expect(capabilities.some((entry) => entry.block === "custom:probe_second")).toBe(true);
  });

  it("runs a custom block's explicit value and an unset block's declared default", async () => {
    const harness = makeDriverHarness(["fake"], { block: false });
    const service = makeService(harness, makeSessionLedger(), modelRuntime, [axisOne(), axisTwo()]);
    const view = service.createSession(
      BuilderCreateRequestSchema.parse({
        name: "Custom",
        composition: { framework: "fake", custom: { probe_axis: "low" } },
      }),
    );

    await collect(service.chatTurn(view.id, "go"));

    // The explicit choice stays; the unset block runs the default its chip shows.
    expect(harness.contexts[0]?.config.custom).toEqual({ probe_axis: "low", probe_second: "two" });
    // The choice is persisted, not only carried into this turn's run.
    const detail = await service.getSessionDetail(view.id);
    expect(detail.session.composition.custom).toEqual({ probe_axis: "low" });
  });

  it("rejects a custom block no registered dimension provides", () => {
    const service = makeService(makeDriverHarness(["fake"]), makeSessionLedger(), modelRuntime, [axisOne()]);
    expect(() =>
      service.createSession(
        BuilderCreateRequestSchema.parse({
          name: "Ghost",
          composition: { framework: "fake", custom: { ghost_axis: "x" } },
        }),
      ),
    ).toThrow(/ghost_axis/);
  });

  it("rejects a second concurrent turn with 409", async () => {
    const harness = makeDriverHarness(["fake"], { block: true });
    const service = makeService(harness);
    const view = service.createSession(BuilderCreateRequestSchema.parse({ composition: { framework: "fake" } }));

    const generator = service.chatTurn(view.id, "long-running");
    const first = await generator.next();
    expect(first.value.stream).toBeDefined();

    // An async generator only throws on iteration (guards run before the first chunk).
    await expect(async () => {
      await service.chatTurn(view.id, "collide").next();
    }).rejects.toMatchObject({ status: 409 });
    try {
      service.patchComposition(view.id, BuilderPatchRequestSchema.parse({ composition: { framework: "fake" } }));
      throw new Error("expected patchComposition to reject while a turn is running");
    } catch (error) {
      expect(error).toMatchObject({ status: 409 });
    }

    harness.release();
    await collect(generator);
  });

  it("rejects unknown blocks with 422 and missing sessions with 404", async () => {
    const harness = makeDriverHarness(["fake"], { block: true });
    const service = makeService(harness);
    expect(() =>
      service.createSession(BuilderCreateRequestSchema.parse({ composition: { framework: "autogen" } })),
    ).toThrow(BuilderError);
    expect(() =>
      service.createSession(BuilderCreateRequestSchema.parse({ composition: { framework: "fake", tools: ["teleport"] } })),
    ).toThrow(/teleport/);
    await expect(service.getSessionDetail("missing")).rejects.toThrow(BuilderError);
    harness.release();
  });

  it("applies the same availability gate to a swap, not only to creation", async () => {
    // patchComposition shares assertCompositionAvailable with createSession: a
    // PATCH swapping onto a block the live palette does not offer (a deleted or
    // disabled endpoint id) must throw before any turn, never surface mid-run.
    // The framework is carried explicitly because the patch schema's field
    // defaults fill the partial composition (framework would otherwise reset
    // to "native" and trip the framework gate first).
    const harness = makeDriverHarness(["fake"], { block: true });
    const service = makeService(harness);
    const view = service.createSession(BuilderCreateRequestSchema.parse({ name: "S", composition: { framework: "fake" } }));
    harness.release();
    expect(() =>
      service.patchComposition(
        view.id,
        BuilderPatchRequestSchema.parse({ composition: { framework: "fake", endpoint_id: "ghost" } }),
      ),
    ).toThrow(/ghost/);
    // The rejected swap leaves the stored composition untouched.
    const detail = await service.getSessionDetail(view.id);
    expect(detail.session.composition.endpoint_id).toBe("");
  });

  it("keeps the terminal complete on long turns (tail retention, not first-N)", async () => {
    // thought_delta streams per chunk: 900 deltas exceed MAX_TURN_EVENTS. First-N retention
    // would lose the terminal complete (turn misreported failed, history dropped) and extract
    // a stale answer from the head.
    const deltas: ArenaEvent[] = Array.from({ length: 900 }, () => ({
      ...thoughtEvent("x"),
      type: "thought_delta" as const,
    }));
    const script: ArenaEvent[] = [
      ...deltas,
      thoughtEvent("Final answer here"),
      completeEvent({ pipeline: "builder", metrics: METRICS, turn: 1, runId: "r1", agentId: "a1", timestamp: 0 }),
    ];
    const harness = makeDriverHarness(["fake"], { script });
    const service = makeService(harness);
    const view = service.createSession(BuilderCreateRequestSchema.parse({ name: "Long", composition: { framework: "fake" } }));

    const { chunks } = await collect(service.chatTurn(view.id, "go long"));
    const turnChunk = chunks.find((chunk) => chunk.stream === "turn");
    expect(turnChunk).toMatchObject({ stream: "turn" });
    if (turnChunk?.stream !== "turn") throw new Error("expected a turn chunk");
    expect(turnChunk.turn.answer).toBe("Final answer here");
    expect(turnChunk.turn.metrics?.total_tokens).toBe(15);

    const detail = await service.getSessionDetail(view.id);
    expect(detail.session.turn_count).toBe(1);
    expect(detail.session.history.at(-1)).toEqual({ role: "assistant", content: "Final answer here", turn: 1 });
  });

  it("persists the turn's tool rounds from its action/observation events", async () => {
    // The turn collection retains only pairing-relevant events (the streamed deltas
    // are dropped, the same rule the thread turn path applies): the extraction must
    // still pair each action with the observation that follows it on its column.
    const script: ArenaEvent[] = [
      { ...thoughtEvent("x"), type: "thought_delta" as const },
      {
        ...thoughtEvent(""),
        type: "action",
        step: 1,
        tool: "bash",
        args: { cmd: "ls" },
      },
      {
        ...thoughtEvent(""),
        type: "observation",
        step: 2,
        result: "file.txt",
      },
      thoughtEvent("Answer with tools"),
      completeEvent({ pipeline: "builder", metrics: METRICS, turn: 1, runId: "r1", agentId: "a1", timestamp: 0 }),
    ];
    const harness = makeDriverHarness(["fake"], { script });
    const service = makeService(harness);
    const view = service.createSession(BuilderCreateRequestSchema.parse({ name: "Tools", composition: { framework: "fake" } }));

    await collect(service.chatTurn(view.id, "go"));
    const detail = await service.getSessionDetail(view.id);
    expect(detail.session.history.at(-1)?.tool_rounds).toEqual([
      { tool: "bash", args: { cmd: "ls" }, result: "file.txt" },
    ]);
  });

  it("abortTurn reports whether a turn was running", async () => {
    const harness = makeDriverHarness(["fake"], { block: true });
    const service = makeService(harness);
    const view = service.createSession(BuilderCreateRequestSchema.parse({ composition: { framework: "fake" } }));
    expect(service.abortTurn(view.id)).toBe(false);

    const generator = service.chatTurn(view.id, "slow");
    await generator.next();
    expect(service.abortTurn(view.id)).toBe(true);
    harness.release();
    await collect(generator);
  });
});

describe("BuilderService execution ledger", () => {
  it("records completed turns as builder sessions with answer summaries", async () => {
    const harness = makeDriverHarness(["fake"], { block: true });
    const sessions = makeSessionLedger();
    const service = makeService(harness, sessions);
    const view = service.createSession(BuilderCreateRequestSchema.parse({ name: "A", composition: { framework: "fake" } }));
    harness.release();
    await collect(service.chatTurn(view.id, "hello"));

    const listed = await sessions.listSessions({ kind: "builder" });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ status: "completed", title: "hello" });
    expect(listed[0]?.summary).toContain("Hello from fake");
    expect(listed[0]?.metadata).toMatchObject({ builderSession: view.id, turn: 1 });
  });

  it("records failed turns without breaking the turn flow", async () => {
    const failingLookup: DriverLookup = {
      get: () => ({
        frameworkId: "fake",
        displayName: "fake",
        async *run(): AsyncGenerator<ArenaEvent> {
          throw new Error("mid-turn boom");
        },
      }),
      listAvailable: () => [{ id: "fake", name: "fake", status: "available" as const }],
      listReserved: () => [],
    };
    const sessions = makeSessionLedger();
    const service = makeService({ lookup: failingLookup }, sessions);
    const view = service.createSession(BuilderCreateRequestSchema.parse({ name: "B", composition: { framework: "fake" } }));
    await collect(service.chatTurn(view.id, "hello"));

    const listed = await sessions.listSessions({ kind: "builder" });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe("failed");
  });

  it("records aborted turns as cancelled", async () => {
    const harness = makeDriverHarness(["fake"], { block: true });
    const sessions = makeSessionLedger();
    const service = makeService(harness, sessions);
    const view = service.createSession(BuilderCreateRequestSchema.parse({ name: "C", composition: { framework: "fake" } }));

    const generator = service.chatTurn(view.id, "slow");
    await generator.next();
    expect(service.abortTurn(view.id)).toBe(true);
    harness.release();
    await collect(generator);

    const listed = await sessions.listSessions({ kind: "builder" });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe("cancelled");
  });
});

describe("BuilderService /compact", () => {
  const summarizingRuntime: BuilderModelRuntimeFactory = {
    create: (config) => ({
      llm: {
        async *stream() {
          yield { text: "unused" };
        },
        async invoke() {
          return { text: "HANDOFF SUMMARY", toolCalls: [] };
        },
      },
      llmVendor: { config },
      contextWindow: 128_000,
      maxInputTokens: 120_000,
    }),
  };

  it("replaces history with a summary pair without consuming a turn", async () => {
    const harness = makeDriverHarness(["fake"], { block: false });
    const sessions = makeSessionLedger();
    const service = makeService(harness, sessions, summarizingRuntime);
    const view = service.createSession(BuilderCreateRequestSchema.parse({ name: "A", composition: { framework: "fake" } }));
    await collect(service.chatTurn(view.id, "hello"));
    expect((await service.getSessionDetail(view.id)).session.turn_count).toBe(1);

    const { chunks } = await collect(service.chatTurn(view.id, "/compact"));
    const detail = await service.getSessionDetail(view.id);
    expect(detail.session.turn_count).toBe(1);
    expect(detail.session.history).toEqual([
      { role: "user", content: "[Earlier conversation compacted into the next message]" },
      { role: "assistant", content: "HANDOFF SUMMARY" },
    ]);
    const last = chunks.at(-1);
    expect(last?.stream).toBe("turn");
    const rows = await sessions.listSessions({ kind: "builder" });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.status)).toEqual(["completed", "completed"]);
    expect(rows[0]?.summary).toContain("compacted");
  });

  it("refuses empty history without opening a ledger row", async () => {
    const harness = makeDriverHarness(["fake"], { block: false });
    const sessions = makeSessionLedger();
    const service = makeService(harness, sessions, summarizingRuntime);
    const view = service.createSession(BuilderCreateRequestSchema.parse({ name: "B", composition: { framework: "fake" } }));
    await expect(collect(service.chatTurn(view.id, "/compact"))).rejects.toThrow(/Nothing to compact/);
    expect(await sessions.listSessions({ kind: "builder" })).toHaveLength(0);
  });

  it("treats longer /compact-prefixed text as a normal turn", async () => {
    const harness = makeDriverHarness(["fake"], { block: false });
    const sessions = makeSessionLedger();
    const service = makeService(harness, sessions, summarizingRuntime);
    const view = service.createSession(BuilderCreateRequestSchema.parse({ name: "C", composition: { framework: "fake" } }));
    await collect(service.chatTurn(view.id, "/compact now please"));
    const detail = await service.getSessionDetail(view.id);
    expect(detail.session.history[0]).toEqual({ role: "user", content: "/compact now please", turn: 1 });
    expect(await sessions.listSessions({ kind: "builder" })).toHaveLength(1);
  });
});

describe("BuilderService chat attachments", () => {
  it("seeds attachments into fresh session workspaces", async () => {
    const harness = makeDriverHarness(["fake"], { block: false });
    const service = makeService(harness);
    const view = service.createSession(BuilderCreateRequestSchema.parse({ name: "A", composition: { framework: "fake" } }));
    await collect(
      service.chatTurn(view.id, "hello", {
        attachments: [{ name: "seed.txt", content: "seeded" }],
      }),
    );
    const workspace = harness.contexts[0]?.workspace;
    expect(workspace?.fs.readFile("seed.txt")).toBe("seeded");
  });

  it("skips seeding on follow-up turns reusing the workspace", async () => {
    const harness = makeDriverHarness(["fake"], { block: false });
    const service = makeService(harness);
    const view = service.createSession(BuilderCreateRequestSchema.parse({ name: "B", composition: { framework: "fake" } }));
    await collect(service.chatTurn(view.id, "first"));
    const workspaceName = harness.contexts[0]?.workspace.name ?? "";
    expect(workspaceName).not.toBe("");
    // Same workspace reused: agent-execution only seeds freshly created workspaces.
    await collect(
      service.chatTurn(view.id, "second", {
        attachments: [{ name: "late.txt", content: "late" }],
      }),
    );
    expect(harness.contexts[1]?.workspace.name).toBe(workspaceName);
    expect(() => harness.contexts[1]?.workspace.fs.readFile("late.txt")).toThrow();
  });
});

describe("BuilderService ask_user human channel", () => {
  it("delivers a human answer into the live ask_user tool result", async () => {
    // Holder object: a plain `let` assigned only inside the generator closure is
    // control-flow-narrowed to null at the read site (TS2339 on `.ok`).
    const askOutcome: { current: ToolExecutionResult | null } = { current: null };
    const askDriver: AgentDriver = {
      frameworkId: "fake",
      displayName: "fake",
      async *run(context: AgentExecutionContext) {
        yield thoughtEvent("asking");
        askOutcome.current = await context.tools.execute("ask_user", {
          questions: [{ id: "mode", question: "Fast or thorough?", options: ["fast", "thorough"] }],
        });
        yield completeEvent({
          pipeline: "builder",
          workspace: context.workspace.name,
          metrics: METRICS,
          turn: context.turn,
          runId: context.identity.runId,
          agentId: context.identity.agentId,
          timestamp: 0,
        });
      },
    };
    const harness = makeDriverHarness(["fake"]);
    // Swap in the ask-driving driver (same lookup shape).
    const lookup: DriverLookup = {
      ...harness.lookup,
      get: (id: string) => (id === "fake" ? askDriver : harness.lookup.get(id)),
    };
    const service = makeService({ lookup });
    const view = service.createSession(
      BuilderCreateRequestSchema.parse({ name: "ask", composition: { framework: "fake", tools: ["ask_user"] } }),
    );

    const consumption = collect(service.chatTurn(view.id, "ask me"));
    // The tool registers the pending batch a few microtasks into the turn; poll
    // until the service reports a live question, then answer it.
    let delivered = false;
    for (let i = 0; i < 500 && !delivered; i += 1) {
      delivered = service.answerQuestion(view.id, "mode", "fast");
      if (!delivered) await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await consumption;
    expect(askOutcome.current).not.toBeNull();
    expect(askOutcome.current?.ok).toBe(true);
    expect(askOutcome.current?.result).toContain("The human answered inline");
    expect(askOutcome.current?.result).toContain("[mode] fast");
  });

  it("reports false for unknown question ids without disturbing the pending batch", async () => {
    const harness = makeDriverHarness(["fake"], { block: true });
    const service = makeService(harness);
    const view = service.createSession(BuilderCreateRequestSchema.parse({ name: "idle", composition: { framework: "fake" } }));
    expect(service.answerQuestion(view.id, "q1", "x")).toBe(false);
    harness.release();
  });

  it("exposes pending questions while the turn waits", async () => {
    const askDriver: AgentDriver = {
      frameworkId: "fake",
      displayName: "fake",
      async *run(context: AgentExecutionContext) {
        yield thoughtEvent("asking");
        await context.tools.execute("ask_user", {
          questions: [{ id: "mode", question: "Fast or thorough?", options: ["fast", "thorough"] }],
        });
        yield completeEvent({
          pipeline: "builder",
          workspace: context.workspace.name,
          metrics: METRICS,
          turn: context.turn,
          runId: context.identity.runId,
          agentId: context.identity.agentId,
          timestamp: 0,
        });
      },
    };
    const harness = makeDriverHarness(["fake"]);
    const lookup: DriverLookup = {
      ...harness.lookup,
      get: (id: string) => (id === "fake" ? askDriver : harness.lookup.get(id)),
    };
    const service = makeService({ lookup });
    const view = service.createSession(
      BuilderCreateRequestSchema.parse({ name: "ask", composition: { framework: "fake", tools: ["ask_user"] } }),
    );
    expect(service.pendingAsk(view.id)).toEqual([]);

    const consumption = collect(service.chatTurn(view.id, "ask me"));
    let sawPending = false;
    let delivered = false;
    for (let i = 0; i < 500 && !delivered; i += 1) {
      if (!sawPending && service.pendingAsk(view.id).some((q) => q.id === "mode")) sawPending = true;
      delivered = service.answerQuestion(view.id, "mode", "fast");
      if (!delivered) await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await consumption;
    expect(sawPending).toBe(true);
    expect(delivered).toBe(true);
    expect(service.pendingAsk(view.id)).toEqual([]);
  });
});
