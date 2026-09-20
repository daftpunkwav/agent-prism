/**
 * @file run_job tool tests
 * @description Locks background lifecycle: start/poll deltas, kill, list, caps.
 *
 * Responsibilities:
 * - Pin job lifecycle state transitions and incremental poll deltas
 * - Pin output caps and the spill/rotation wiring
 */

import { describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";
import { runJobTool } from "@agentprism/tool-builtins";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { removeWorkspace } from "./remove-workspace.js";

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-runjob-"));
  return {
    name: "ws",
    root,
    cwd: () => root,
    fs: new ScopedFileSystem(root),
    cleanup: () => removeWorkspace(root),
  };
}

const NODE = process.execPath;

/** Wall-clock cap for one job to settle: far above a cold child start under load. */
const POLL_BUDGET_MS = 60_000;

async function start(ws: ReturnType<typeof tempWorkspace>, command: string): Promise<string> {
  const out = await runJobTool.execute(ws, { action: "start", command });
  expect(out.ok).toBe(true);
  const id = out.result.match(/started (job-\d+)/)?.[1] ?? "";
  expect(id).not.toBe("");
  return id;
}

async function pollUntilDone(ws: ReturnType<typeof tempWorkspace>, id: string): Promise<string> {
  // Accumulate every poll like a model would: intermediate polls are consumed, not kept.
  // The budget is wall-clock, not an iteration count: the wait covers a cold child start
  // under parallel load, which stretches further under coverage instrumentation. A fixed
  // iteration cap turns that slowdown into a false "job did not finish".
  let acc = "";
  const deadline = Date.now() + POLL_BUDGET_MS;
  for (;;) {
    const out = await runJobTool.execute(ws, { action: "poll", job_id: id });
    expect(out.ok).toBe(true);
    acc += `\n${out.result}`;
    if (/exited \(|killed|finished/.test(out.result)) return acc;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  // Reclaim the child before failing: a live job holds the workspace directory,
  // so teardown would report EPERM instead of the real cause.
  await runJobTool.execute(ws, { action: "kill", job_id: id });
  throw new Error(`job ${id} did not finish within ${POLL_BUDGET_MS}ms: ${acc}`);
}

describe("runJobTool", () => {
  it("starts a command and polls incremental deltas", async () => {
    const ws = tempWorkspace();
    try {
      const id = await start(ws, `${NODE} -e "console.log('hello-job')"`);
      const first = await pollUntilDone(ws, id);
      expect(first).toContain("hello-job");
      const second = await runJobTool.execute(ws, { action: "poll", job_id: id });
      expect(second.ok).toBe(true);
      expect(second.result).toContain("(no new output)");
    } finally {
      ws.cleanup();
    }
  });

  it("kills a hanging job", async () => {
    const ws = tempWorkspace();
    try {
      const id = await start(ws, `${NODE} -e "setTimeout(()=>{},30000)"`);
      const killed = await runJobTool.execute(ws, { action: "kill", job_id: id });
      expect(killed.ok).toBe(true);
      expect(killed.result).toContain("kill sent");
      const last = await pollUntilDone(ws, id);
      expect(/killed|exited/.test(last)).toBe(true);
    } finally {
      ws.cleanup();
    }
  });

  it("lists live jobs and rejects bad input fail-closed", async () => {
    const ws = tempWorkspace();
    try {
      const empty = await runJobTool.execute(ws, { action: "list" });
      expect(empty.ok).toBe(true);
      expect(empty.result).toContain("no background jobs");
      const id = await start(ws, `${NODE} -e "setTimeout(()=>{},30000)"`);
      try {
        const listed = await runJobTool.execute(ws, { action: "list" });
        expect(listed.result).toContain(id);
        for (const bad of [
          { action: "fly" },
          { action: "start", command: "  " },
          { action: "poll", job_id: "job-999" },
          { action: "kill" },
          {},
        ]) {
          const out = await runJobTool.execute(ws, bad as Record<string, unknown>);
          expect(out.ok).toBe(false);
          expect(out.code).toBe("workspace_error");
        }
      } finally {
        await runJobTool.execute(ws, { action: "kill", job_id: id });
        // Wait for the exit before teardown: a dying child still holds the workspace.
        await pollUntilDone(ws, id);
      }
    } finally {
      ws.cleanup();
    }
  });
});

describe("runJobTool log spill", () => {
  it("spills oversized deltas to workspace files with rotation", async () => {
    const ws = tempWorkspace();
    try {
      const big = `${process.execPath} -e "console.log('y'.repeat(40000))"`;
      const first = await runJobTool.execute(ws, { action: "start", command: big });
      expect(first.ok).toBe(true);
      const id = first.result.match(/started (job-\d+)/)?.[1] ?? "";
      const transcript = await pollUntilDone(ws, id);
      expect(transcript).toContain("spilled to .spills/");
      expect(transcript).toContain("for the middle");
      const spilled = ws.fs.listFiles(".spills", { recursive: false });
      expect(spilled).toHaveLength(1);
      expect(spilled[0]).toMatch(/^\.spills\/\d{6}-job-1\.log$/);
      expect(ws.fs.readFile(spilled[0] as string)).toContain("y".repeat(1000));
    } finally {
      ws.cleanup();
    }
  });

  it("keeps small deltas inline without spilling", async () => {
    const ws = tempWorkspace();
    try {
      const started = await runJobTool.execute(ws, { action: "start", command: `${process.execPath} -e "console.log(1)"` });
      const id = started.result.match(/started (job-\d+)/)?.[1] ?? "";
      // Poll to a confirmed exit: asserting on a still-running job would pass for
      // the wrong reason (and leave the child holding the workspace).
      const transcript = await pollUntilDone(ws, id);
      expect(transcript).not.toContain("spilled to");
      expect(ws.fs.exists(".spills")).toBe(false);
    } finally {
      ws.cleanup();
    }
  });
});

describe("runJobTool spill rotation", () => {
  // Three sequential jobs, each spawning node (cold start can take seconds on a
  // loaded machine): the global 30s testTimeout routinely fires before the third
  // job settles, so this case carries its own budget. The behavior assertions
  // (file naming/order) are unchanged.
  it("names spill files so lexicographic order is chronological", { timeout: 180_000 }, async () => {
    const ws = tempWorkspace();
    try {
      for (let i = 0; i < 3; i += 1) {
        const started = await runJobTool.execute(ws, {
          action: "start",
          command: `${process.execPath} -e "console.log('z'.repeat(40000))"`,
        });
        const id = started.result.match(/started (job-\d+)/)?.[1] ?? "";
        await pollUntilDone(ws, id);
      }
      const spilled = ws.fs.listFiles(".spills", { recursive: false });
      expect(spilled).toHaveLength(3);
      const sorted = [...spilled].sort();
      expect(spilled).toEqual(sorted);
      expect(sorted[0]).toMatch(/000001-job-1\.log$/);
      expect(sorted[2]).toMatch(/000003-job-3\.log$/);
    } finally {
      ws.cleanup();
    }
  });
});
