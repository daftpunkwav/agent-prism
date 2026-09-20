/**
 * @file thread service tests
 * @description Locks thread run/resume and fork semantics at the service level.
 *
 * Responsibilities:
 * - Pin the single-column arena request assembly (label pin, baseline overrides, column session)
 * - Pin success-only transcript commit, running guard, and fork workspace branching
 */

import { describe, expect, it, vi } from "vitest";
import type { ArenaEvent, Clock, IdGenerator, PipelineConfig, ThreadMessage } from "@agentprism/contracts";
import { BaselineOverridesSchema, PipelineConfigSchema } from "@agentprism/contracts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AtomicJsonFile } from "@agentprism/persistence";
import type { ArenaRunRequest } from "@agentprism/contracts";
import type { ArenaService } from "../src/arena-service.js";
import { AppError } from "../src/errors.js";
import { FileThreadStore } from "../src/thread-store.js";
import { THREAD_BASELINE_FIELDS, ThreadService, type ThreadWorkspaces } from "../src/thread-service.js";

const clock: Clock = { now: () => 1_700_000_000_000 };
let idCounter = 0;
const ids: IdGenerator = { next: () => `id${(idCounter += 1).toString().padStart(4, "0")}` };

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), "thread-svc-")), `${randomUUID()}.json`);
}

const CONFIG: PipelineConfig = PipelineConfigSchema.parse({ label: "col" });

function baseEvent(type: ArenaEvent["type"]): ArenaEvent {
  return {
    type,
    pipeline: "",
    workspace: "",
    content: "",
    tool: "",
    args: {},
    result: "",
    step: 0,
    passed: null,
    reason: "",
    metrics: null,
    message: "",
    token_stats: null,
    turn: 1,
    runId: "r1",
    timestamp: 0,
  } as ArenaEvent;
}

/** Arena double: records requests and replay validations, replays a scripted stream re-labelled to the actual column. */
function fakeArena(script: ArenaEvent[], throwAfter?: Error): {
  arena: ArenaService;
  requests: ArenaRunRequest[];
  validations: Array<{ dimension: string; selections: readonly string[]; baseline: Record<string, unknown> }>;
} {
  const requests: ArenaRunRequest[] = [];
  const validations: Array<{ dimension: string; selections: readonly string[]; baseline: Record<string, unknown> }> = [];
  const arena = {
    assertBaselineReplayable(dimension: string, selections: readonly string[], baseline: Record<string, unknown>) {
      validations.push({ dimension, selections, baseline });
    },
    async *run(request: ArenaRunRequest, _options: { signal?: AbortSignal } = {}) {
      requests.push(request);
      const label = typeof request.baseline?.label === "string" ? request.baseline.label : "";
      for (const event of script) {
        yield { ...event, pipeline: label, workspace: event.workspace === "" ? label : event.workspace };
      }
      if (throwAfter !== undefined) throw throwAfter;
    },
  } as unknown as ArenaService;
  return { arena, requests, validations };
}

function fakeWorkspaces(): ThreadWorkspaces & { clones: Array<[string, string]>; pinned: string[]; unpinned: string[] } {
  const clones: Array<[string, string]> = [];
  const pinned: string[] = [];
  const unpinned: string[] = [];
  return {
    clones,
    pinned,
    unpinned,
    protectedCount: () => 0,
    clone: async (source: string, newName: string) => {
      clones.push([source, newName]);
      return { cloned: `${source}->${newName}` };
    },
    pin(name: string) {
      pinned.push(name);
    },
    unpin(name: string) {
      unpinned.push(name);
    },
  };
}

function makeService(arena: ArenaService, workspaces = fakeWorkspaces()) {
  const store = new FileThreadStore({ file: new AtomicJsonFile(tempFile()), idGenerator: ids, clock });
  const service = new ThreadService({ threads: store, arena, workspaceRegistry: workspaces, clock });
  return { service, store };
}

async function drain(stream: AsyncGenerator<ArenaEvent>): Promise<ArenaEvent[]> {
  const events: ArenaEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("ThreadService.run (resume path)", () => {
  it("replays history through column_sessions, pins the label, and commits the turn on success", async () => {
    const { arena, requests } = fakeArena([
      { ...baseEvent("thought"), content: "the final answer" },
      { ...baseEvent("complete"), metrics: { success: true } as ArenaEvent["metrics"] },
    ]);
    const { service, store } = makeService(arena);
    const view = service.create({ title: "t", config: CONFIG });
    store.appendTurn(view.id, "q1", "a1", "");

    const events = await drain(service.run(view.id, { question: "q2" }));
    expect(events).toHaveLength(2);

    const request = requests[0] as ArenaRunRequest;
    expect(request.question).toBe("q2");
    expect(request.selections).toEqual([CONFIG.framework]);
    expect(request.baseline?.label).toBe(`t-${view.id}`);
    expect(request.baseline?.sandbox_mode).toBe(CONFIG.sandbox_mode);
    const session = request.column_sessions?.[`t-${view.id}`];
    expect(session?.messages.map((m) => m.content)).toEqual(["q1", "a1"]);

    const detail = service.getDetail(view.id);
    expect(detail.history.map((m) => m.content)).toEqual(["q1", "a1", "q2", "the final answer"]);
    expect(detail.thread.running).toBe(false);
  });

  it("carries the stored workspace into the run and persists the resolved one on success", async () => {
    const { arena, requests } = fakeArena([
      { ...baseEvent("complete"), metrics: { success: true } as ArenaEvent["metrics"] },
    ]);
    const workspaces = fakeWorkspaces();
    const { service, store } = makeService(arena, workspaces);
    const view = service.create({ title: "t", config: CONFIG });
    store.setWorkspace(view.id, "ws-earlier");

    await drain(service.run(view.id, { question: "q" }));
    expect((requests[0] as ArenaRunRequest).column_sessions?.[`t-${view.id}`]?.workspace).toBe("ws-earlier");
    // The complete event's resolved workspace wins over the stored one.
    expect(store.get(view.id).workspace).toBe(`t-${view.id}`);
    // The resolved workspace is pinned against idle eviction while the thread lives.
    expect(workspaces.pinned).toContain(`t-${view.id}`);
  });

  it("omits the unset endpoint id from the replayed baseline (default config stays runnable)", async () => {
    const { arena, requests } = fakeArena([{ ...baseEvent("complete"), metrics: { success: true } as ArenaEvent["metrics"] }]);
    const { service } = makeService(arena);
    const view = service.create({ title: "t", config: CONFIG });

    await drain(service.run(view.id, { question: "q" }));
    const baseline = requests[0]?.baseline as Record<string, unknown>;
    // "" is the schema default for endpoint_id: replaying it fails baseline legality
    // instead of taking the default endpoint the run path resolves for an absent value.
    expect(CONFIG.endpoint_id).toBe("");
    expect(baseline).not.toHaveProperty("endpoint_id");
    expect(baseline.framework).toBe(CONFIG.framework);
  });

  it("validates the pinned config with the run path's resolver at creation", () => {
    const { arena, validations } = fakeArena([]);
    const { service } = makeService(arena);
    service.create({ title: "t", config: CONFIG });

    expect(validations).toHaveLength(1);
    expect(validations[0]?.dimension).toBe("framework");
    expect(validations[0]?.selections).toEqual([CONFIG.framework]);
    expect(validations[0]?.baseline).not.toHaveProperty("endpoint_id");
  });

  it("leaves the transcript untouched when the turn fails, and resets the running flag", async () => {
    const { arena } = fakeArena([{ ...baseEvent("complete"), metrics: { success: false } as ArenaEvent["metrics"] }]);
    const { service, store } = makeService(arena);
    const view = service.create({ title: "t", config: CONFIG });

    await drain(service.run(view.id, { question: "q" }));
    const detail = service.getDetail(view.id);
    expect(detail.history).toHaveLength(0);
    expect(detail.thread.running).toBe(false);
    expect(detail.thread.turn_count).toBe(0);
  });

  it("resets the running flag when the arena stream itself throws", async () => {
    const { arena } = fakeArena([], new Error("runner exploded"));
    const { service, store } = makeService(arena);
    const view = service.create({ title: "t", config: CONFIG });

    await expect(drain(service.run(view.id, { question: "q" }))).rejects.toThrow("runner exploded");
    expect(store.get(view.id).running).toBe(false);
  });

  it("flushes the store right after committing a turn (the resume anchor survives shutdown)", async () => {
    const { arena } = fakeArena([{ ...baseEvent("complete"), metrics: { success: true } as ArenaEvent["metrics"] }]);
    const { service, store } = makeService(arena);
    const view = service.create({ title: "t", config: CONFIG });
    const flushSpy = vi.spyOn(store, "flushNow");

    await drain(service.run(view.id, { question: "q" }));
    expect(flushSpy).toHaveBeenCalled();
  });

  it("refuses a second concurrent turn with 409", async () => {
    const { arena } = fakeArena([{ ...baseEvent("complete"), metrics: { success: true } as ArenaEvent["metrics"] }]);
    const { service, store } = makeService(arena);
    const view = service.create({ title: "t", config: CONFIG });
    store.markRunning(view.id, true);

    await expect(service.run(view.id, { question: "q" }).next()).rejects.toMatchObject({ status: 409 });
  });

  it("writes an agent ledger row when sessions are wired", async () => {
    const { arena } = fakeArena([{ ...baseEvent("complete"), metrics: { success: true } as ArenaEvent["metrics"] }]);
    const { InMemorySessionStore } = await import("@agentprism/session");
    const { SessionService } = await import("../src/session-service.js");
    const sessions = new SessionService({
      store: new InMemorySessionStore({ idGenerator: ids, clock }),
    });
    const store = new FileThreadStore({ file: new AtomicJsonFile(tempFile()), idGenerator: ids, clock });
    const service = new ThreadService({ threads: store, arena, workspaceRegistry: fakeWorkspaces(), clock, sessions });
    const view = service.create({ title: "t", config: CONFIG });

    await drain(service.run(view.id, { question: "q" }));
    expect(await sessions.listSessions({ kind: "agent" })).toHaveLength(1);
  });
});

describe("ThreadService.create", () => {
  it("keeps the pinned baseline field list in step with the wire schema", () => {
    // Both directions drift silently otherwise: a wire field missing from the list
    // stops being pinned, and a listed field the wire dropped fails every run.
    const pinned = new Set<string>(THREAD_BASELINE_FIELDS);
    // model_id derives from endpoint resolution; label is the per-run identity pin.
    const derived = Object.keys(BaselineOverridesSchema.shape).filter((key) => key !== "model_id" && key !== "label");
    expect([...pinned].sort()).toEqual([...derived].sort());
  });

  it("surfaces a create-time replay rejection and stores nothing", () => {
    const arena = {
      assertBaselineReplayable: () => {
        throw AppError.unprocessable("Pinned config cannot be replayed: Baseline field \"temperature\" has unsupported value: 0.55");
      },
    } as unknown as ArenaService;
    const { service, store } = makeService(arena);

    expect(() => service.create({ title: "t", config: CONFIG })).toThrowError(/cannot be replayed/);
    expect(store.list()).toHaveLength(0);
  });
});

describe("ThreadService.fork", () => {
  it("copies the transcript, branches the workspace, and links forkOf", async () => {
    const { arena } = fakeArena([]);
    const workspaces = fakeWorkspaces();
    const { service, store } = makeService(arena, workspaces);
    const parent = service.create({ title: "parent", config: CONFIG });
    store.appendTurn(parent.id, "q1", "a1", "ws-parent");

    const fork = await service.fork(parent.id, { title: "" });
    expect(fork.fork_of).toBe(parent.id);
    expect(fork.title).toBe("parent (fork)");
    expect(fork.workspace).toBe(`t-${fork.id}`);
    expect(workspaces.clones).toEqual([["ws-parent", `t-${fork.id}`]]);
    expect(workspaces.pinned).toContain(`t-${fork.id}`);
    expect(service.getDetail(fork.id).history.map((m: ThreadMessage) => m.content)).toEqual(["q1", "a1"]);
    expect(service.getDetail(parent.id).history).toHaveLength(2);
  });

  it("releases the workspace pin when the thread is deleted", () => {
    const { arena } = fakeArena([]);
    const workspaces = fakeWorkspaces();
    const { service, store } = makeService(arena, workspaces);
    const view = service.create({ title: "t", config: CONFIG });
    store.setWorkspace(view.id, `t-${view.id}`);
    service.getDetail(view.id); // reads re-pin (in-memory pins die with a process)
    expect(workspaces.pinned).toContain(`t-${view.id}`);
    service.deleteThread(view.id);
    expect(workspaces.unpinned).toContain(`t-${view.id}`);
  });

  it("keeps the workspace pin when a delete is refused while the turn runs", () => {
    const { arena } = fakeArena([]);
    const workspaces = fakeWorkspaces();
    const { service, store } = makeService(arena, workspaces);
    const view = service.create({ title: "t", config: CONFIG });
    store.setWorkspace(view.id, `t-${view.id}`);
    store.markRunning(view.id, true);

    expect(() => service.deleteThread(view.id)).toThrowError(/while a turn is running/);
    // The record still points at the workspace: releasing the pin here would leave
    // it evictable and the next resume would silently start from an empty tree.
    expect(workspaces.unpinned).toEqual([]);
    expect(store.get(view.id).workspace).toBe(`t-${view.id}`);
  });

  it("holds the parent busy while branching, so no turn can write the copied tree", async () => {
    const { arena } = fakeArena([]);
    const workspaces = fakeWorkspaces();
    const { service, store } = makeService(arena, workspaces);
    const parent = service.create({ title: "parent", config: CONFIG });
    store.setWorkspace(parent.id, "ws-parent");

    let release!: () => void;
    let cloneStarted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      cloneStarted = resolve;
    });
    workspaces.clone = async () => {
      cloneStarted();
      await gate;
      return {};
    };

    const pending = service.fork(parent.id, {});
    await started;
    // The copy is in flight: a turn must be refused instead of interleaving writes.
    await expect(service.run(parent.id, { question: "q" }).next()).rejects.toMatchObject({ status: 409 });

    release();
    const fork = await pending;
    expect(fork.fork_of).toBe(parent.id);
    // The parent returns to idle once the branch settles.
    expect(store.get(parent.id).running).toBe(false);
  });

  it("leaves no record behind when the workspace branch fails", async () => {
    const { arena } = fakeArena([]);
    const workspaces = fakeWorkspaces();
    workspaces.clone = async () => {
      throw new Error("disk full");
    };
    const { service, store } = makeService(arena, workspaces);
    const parent = service.create({ title: "parent", config: CONFIG });
    store.setWorkspace(parent.id, "ws-parent");

    await expect(service.fork(parent.id, {})).rejects.toThrow("disk full");
    expect(store.list()).toHaveLength(1);
    // The busy hold must be released on the failure path too.
    expect(store.get(parent.id).running).toBe(false);
  });

  it("refuses to fork a running thread with 409", async () => {
    const { arena } = fakeArena([]);
    const { service, store } = makeService(arena);
    const parent = service.create({ title: "p", config: CONFIG });
    store.markRunning(parent.id, true);

    await expect(service.fork(parent.id, {})).rejects.toMatchObject({ status: 409 });
  });

  it("roots without a workspace fork cleanly (history only)", async () => {
    const { arena } = fakeArena([]);
    const workspaces = fakeWorkspaces();
    const { service } = makeService(arena, workspaces);
    const parent = service.create({ title: "p", config: CONFIG });
    const fork = await service.fork(parent.id, {});
    expect(fork.workspace).toBe("");
    expect(workspaces.clones).toEqual([]);
  });
});
