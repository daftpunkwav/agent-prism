/**
 * @file bash_session send queue tests
 * @description Locks per-shell send serialization with a scripted fake shell.
 *
 * Responsibilities:
 * - Pin that a concurrent send queues instead of interleaving its polling
 *   window (the overlapping-poll theft: the later sentinel's send consumes the
 *   first send's whole output region and strands it into a false timeout)
 * - Pin the fail-closed path for a queued send whose shell was restarted
 * - Pin that an aborted queued send never writes into the resident shell
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// Shared fake-shell state: the mock factory and the tests both need it, so it
// lives in vi.hoisted (vi.mock factories are hoisted above every import).
const fake = vi.hoisted(() => ({
  buffer: "",
  start: 0,
  writes: [] as string[],
  alive: true,
}));

vi.mock("@agentprism/environment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentprism/environment")>();
  const { WorkspaceError } = actual;
  return {
    ...actual,
    spawnPersistentShell: () => ({
      pid: 4242,
      alive: () => fake.alive,
      write: (data: string) => {
        // Parity with the real handle: writing to a shell whose stdin already
        // ended throws (the queued-send conversion test depends on the throw).
        if (!fake.alive) throw new WorkspaceError("Error: persistent shell is closed");
        fake.writes.push(data);
      },
      output: () => fake.buffer,
      outputStart: () => fake.start,
      kill: () => {
        fake.alive = false;
      },
    }),
  };
});

import { bashSessionTool } from "@agentprism/tool-builtins";

let rootSeq = 0;

/** Minimal workspace: asWorkspaceView only needs fs to be an object; small results never spill. */
function fakeWorkspace() {
  rootSeq += 1;
  const root = `//fake-bashsess-${rootSeq}`;
  return { name: "ws", root, cwd: () => root, fs: {} };
}

/** First send on a fresh record carries sentinel seq 1. */
const MARKER_1 = "__AP_DONE_1__:0\n";
const MARKER_2 = "__AP_DONE_2__:0\n";

describe("bashSessionTool send queue", () => {
  beforeEach(() => {
    fake.buffer = "";
    fake.start = 0;
    fake.writes.length = 0;
    fake.alive = true;
  });

  it("queues a concurrent send until the in-flight send settles", async () => {
    const ws = fakeWorkspace();
    const start = await bashSessionTool.execute(ws, { action: "start" });
    expect(start.ok).toBe(true);
    expect(fake.writes).toHaveLength(0);

    const slow = bashSessionTool.execute(ws, { action: "send", command: "sleep 5; echo slow-done", timeout: 5 });
    await vi.waitFor(() => expect(fake.writes).toHaveLength(1));
    expect(fake.writes[0]).toContain("sleep 5");

    const quick = bashSessionTool.execute(ws, { action: "send", command: "echo quick-done" });
    // Give the concurrent send several poll ticks to (wrongly) interleave.
    await new Promise((resolve) => setTimeout(resolve, 80));
    // The queued send must not touch the shell while the first send is polling.
    expect(fake.writes).toHaveLength(1);

    fake.buffer += `slow-out\n${MARKER_1}`;
    const slowRes = await slow;
    expect(slowRes.ok).toBe(true);
    expect(slowRes.result).toContain("slow-out");
    expect(slowRes.result).toContain("[exit 0]");

    // The queued send ran after the first settled and reports only its own output.
    expect(fake.writes).toHaveLength(2);
    expect(fake.writes[1]).toContain("echo quick-done");
    fake.buffer += `quick-out\n${MARKER_2}`;
    const quickRes = await quick;
    expect(quickRes.ok).toBe(true);
    expect(quickRes.result).toContain("quick-out");
    expect(quickRes.result).toContain("[exit 0]");
    expect(quickRes.result).not.toContain("slow-out");
    expect(quickRes.result).not.toContain("__AP_DONE_");
    expect(quickRes.result).not.toContain("Still running");
  });

  it("fails a queued send closed when the shell was restarted while it waited", async () => {
    const ws = fakeWorkspace();
    await bashSessionTool.execute(ws, { action: "start" });
    const slow = bashSessionTool.execute(ws, { action: "send", command: "sleep 5; echo first", timeout: 5 });
    await vi.waitFor(() => expect(fake.writes).toHaveLength(1));

    const queued = bashSessionTool.execute(ws, { action: "send", command: "echo second" });
    // Close + start while the send waits: the fresh record owns the stream now.
    await bashSessionTool.execute(ws, { action: "close" });
    await bashSessionTool.execute(ws, { action: "start" });

    fake.buffer += `first-out\n${MARKER_1}`;
    const [slowRes, queuedRes] = await Promise.all([slow, queued]);
    expect(slowRes.ok).toBe(true);
    // The stale queued send must not write into the NEW shell's stream.
    expect(queuedRes.ok).toBe(false);
    expect(queuedRes.result).toContain("no live shell");
    expect(fake.writes).toHaveLength(1);
  });

  it("does not write a queued send whose signal aborted while it waited", async () => {
    const ws = fakeWorkspace();
    await bashSessionTool.execute(ws, { action: "start" });
    const slow = bashSessionTool.execute(ws, { action: "send", command: "sleep 5; echo first", timeout: 5 });
    await vi.waitFor(() => expect(fake.writes).toHaveLength(1));

    const controller = new AbortController();
    const queued = bashSessionTool.execute(ws, { action: "send", command: "echo second" }, controller.signal);
    controller.abort();
    fake.buffer += `first-out\n${MARKER_1}`;
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    const slowRes = await slow;
    expect(slowRes.result).toContain("first-out");
    // The aborted queued send never wrote into the resident shell.
    expect(fake.writes).toHaveLength(1);
  });

  it("rejects an aborted queued send promptly, before the active send settles", async () => {
    const ws = fakeWorkspace();
    await bashSessionTool.execute(ws, { action: "start" });
    const slow = bashSessionTool.execute(ws, { action: "send", command: "sleep 30; echo first", timeout: 20 });
    await vi.waitFor(() => expect(fake.writes).toHaveLength(1));

    const controller = new AbortController();
    const queued = bashSessionTool.execute(ws, { action: "send", command: "echo second" }, controller.signal);
    controller.abort();
    // The rejection must not wait for the active send's polling window: it
    // lands while the active send is still polling (no sentinel delivered yet).
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.writes).toHaveLength(1);
    fake.buffer += `first-out\n${MARKER_1}`;
    const slowRes = await slow;
    expect(slowRes.ok).toBe(true);
  });

  it("rejects a pre-aborted queued send immediately without touching the queue", async () => {
    const ws = fakeWorkspace();
    await bashSessionTool.execute(ws, { action: "start" });
    const slow = bashSessionTool.execute(ws, { action: "send", command: "sleep 30; echo first", timeout: 20 });
    await vi.waitFor(() => expect(fake.writes).toHaveLength(1));

    // Already aborted at call time: the listener below would never fire.
    const controller = new AbortController();
    controller.abort();
    const queued = bashSessionTool.execute(ws, { action: "send", command: "echo second" }, controller.signal);
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.writes).toHaveLength(1);
    fake.buffer += `first-out\n${MARKER_1}`;
    const slowRes = await slow;
    expect(slowRes.ok).toBe(true);
  });

  it("converts a queued send's dead-shell write failure into the workspace_error result", async () => {
    const ws = fakeWorkspace();
    await bashSessionTool.execute(ws, { action: "start" });
    const slow = bashSessionTool.execute(ws, { action: "send", command: "sleep 5; echo first", timeout: 5 });
    await vi.waitFor(() => expect(fake.writes).toHaveLength(1));

    const queued = bashSessionTool.execute(ws, { action: "send", command: "echo second" });
    // The shell dies after the queued send passed the entry liveness check but
    // before its turn in the queue: the write inside the queued task throws.
    fake.alive = false;
    fake.buffer += `first-out\n${MARKER_1}`;
    const [slowRes, queuedRes] = await Promise.all([slow, queued]);
    expect(slowRes.ok).toBe(true);
    // The tool call must observe the workspace_error contract, not a raw throw.
    expect(queuedRes.ok).toBe(false);
    expect(queuedRes.result).toContain("persistent shell is closed");
    expect(queuedRes.code).toBe("workspace_error");
  });
});
