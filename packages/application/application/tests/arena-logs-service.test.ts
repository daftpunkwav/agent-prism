/**
 * @file arena logs service tests
 * @description Locks the write→read loop of per-run column logs: runner-side
 * appends (RunTraceLogs) must be readable via ArenaLogsService with the same
 * on-disk naming, tail caps, and torn-line tolerance.
 *
 * Responsibilities:
 * - Pin file-name convergence, tail caps with the truncated flag, and the
 *   empty-result fallback for unknown workspaces
 */

import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceRegistry } from "@agentprism/runtime";
import type { ArenaEvent } from "@agentprism/contracts";
import { RunTraceLogs } from "@agentprism/arena-runner";
import { ArenaLogsService } from "@agentprism/application";

function setup() {
  const runsRoot = join(tmpdir(), `aprism-arena-logs-${randomUUID()}`);
  const registry = new WorkspaceRegistry({ runsRoot, clock: { now: () => 0 } });
  const logs = new RunTraceLogs(registry.traceDir("run-1"), () => 42);
  return {
    runsRoot,
    registry,
    logs,
    // Appends are async: settle them before deleting the tree (Windows rmSync races writers).
    teardown: async () => {
      await logs.flush();
      rmSync(runsRoot, { recursive: true, force: true });
    },
  };
}

function thoughtEvent(step: number, content: string): ArenaEvent {
  return {
    type: "thought_delta",
    pipeline: "CoT_Tool",
    workspace: "ws1",
    content,
    tool: "",
    args: {},
    result: "",
    step,
    passed: null,
    reason: "",
    metrics: null,
    message: "",
    token_stats: null,
    turn: 1,
    runId: "run-1",
    timestamp: 0,
  };
}

/** One wire-log JSONL row with a padded request payload (size control for window tests). */
function wireRow(seq: number, pad: number): string {
  return JSON.stringify({
    seq,
    ts: seq,
    turn: 1,
    record: {
      kind: "llm_request",
      title: `r${seq}`,
      data: { model: "m1", messages: [{ role: "user", content: "x".repeat(pad) }], tools: [] },
      durationMs: null,
    },
  });
}

/** Whole-file reference reader (the pre-window implementation) pinning windowed-read parity. */
function wholeFileTail(file: string, cap: number): { rows: unknown[]; truncated: boolean } {
  const lines = readFileSync(file, "utf-8").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const truncated = lines.length > cap;
  const rows: unknown[] = [];
  for (const line of truncated ? lines.slice(-cap) : lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // Torn lines never parse; identical to the windowed reader.
    }
  }
  return { rows, truncated };
}

describe("ArenaLogsService column logs", () => {
  it("reads back events and wire records the runner appended", async () => {
    const { registry, logs, teardown } = setup();
    try {
      registry.create("ws1", "run-1");
      logs.appendEvent("CoT_Tool", thoughtEvent(1, "hello"));
      logs.appendWire("CoT_Tool", 1, {
        kind: "llm_request",
        title: "LLM request → m1 (2 messages)",
        data: { model: "m1", messages: [], tools: [] },
        durationMs: null,
      });
      await logs.flush();

      const service = new ArenaLogsService({ workspaceRegistry: registry });
      const result = service.columnLogs("ws1", "CoT_Tool");
      expect(result.workspace).toBe("ws1");
      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.content).toBe("hello");
      expect(result.wire).toHaveLength(1);
      expect(result.wire[0]!.turn).toBe(1);
      expect(result.wire[0]!.record.kind).toBe("llm_request");
      expect(result.truncated).toBe(false);
    } finally {
      await teardown();
    }
  });

  it("returns an empty (not throwing) result for unknown workspaces or labels", async () => {
    const { registry, logs, teardown } = setup();
    try {
      registry.create("ws1", "run-1");
      logs.appendEvent("CoT_Tool", thoughtEvent(1, "hello"));
      const service = new ArenaLogsService({ workspaceRegistry: registry });
      expect(service.columnLogs("missing-ws", "CoT_Tool").events).toHaveLength(0);
      expect(service.columnLogs("ws1", "OtherLane").events).toHaveLength(0);
    } finally {
      await teardown();
    }
  });

  it("caps the read to the tail, flags truncation, and skips torn tail lines", async () => {
    const { registry, logs, teardown } = setup();
    try {
      registry.create("ws1", "run-1");
      const total = 4002;
      for (let i = 0; i < total; i += 1) logs.appendEvent("Lane", thoughtEvent(i + 1, `e${i}`));
      await logs.flush();
      // Simulate a crash mid-append: a torn JSON line after the last valid event.
      const file = logs.eventLogPath("Lane");
      const lines = Array.from({ length: total }, (_, i) => JSON.stringify(thoughtEvent(i + 1, `e${i}`)));
      writeFileSync(file, [...lines, '{"type":"thought_delta","pipeline":"Lane","tow', ""].join("\n"), "utf-8");

      const service = new ArenaLogsService({ workspaceRegistry: registry });
      const result = service.columnLogs("ws1", "Lane");
      expect(result.truncated).toBe(true);
      // 4003 rows on disk (4002 events + torn), tail-capped to 4000 rows,
      // of which one does not parse: 3999 events survive.
      expect(result.events).toHaveLength(3999);
      expect(result.events[0]!.content).toBe("e3"); // head dropped past the cap
      expect(result.events.at(-1)!.content).toBe(`e${total - 1}`); // torn line skipped
    } finally {
      await teardown();
    }
  });

  it("does not flag truncation or drop rows when the file has exactly cap rows", async () => {
    const { registry, logs, teardown } = setup();
    try {
      registry.create("ws1", "run-1");
      for (let i = 0; i < 4000; i += 1) logs.appendEvent("Lane", thoughtEvent(i + 1, `e${i}`));
      await logs.flush();
      const service = new ArenaLogsService({ workspaceRegistry: registry });
      const result = service.columnLogs("ws1", "Lane");
      expect(result.truncated).toBe(false);
      expect(result.events).toHaveLength(4000);
      expect(result.events[0]!.content).toBe("e0");
    } finally {
      await teardown();
    }
  });

  it("counts blank lines toward the physical cap but never emits them as rows", async () => {
    const { registry, logs, teardown } = setup();
    try {
      registry.create("ws1", "run-1");
      // 4000 valid rows + 1 blank line = 4001 physical lines: the blank line
      // consumes a cap slot (truncation fires, head row pushed out) while the
      // returned rows stay JSON-parsable only.
      const lines = Array.from({ length: 4000 }, (_, i) => JSON.stringify(thoughtEvent(i + 1, `e${i}`)));
      lines.splice(2000, 0, "");
      writeFileSync(logs.eventLogPath("Lane"), lines.join("\n") + "\n", "utf-8");

      const service = new ArenaLogsService({ workspaceRegistry: registry });
      const result = service.columnLogs("ws1", "Lane");
      expect(result.truncated).toBe(true);
      // The cap window holds 4000 physical lines of which one is blank: 3999
      // real rows survive and the head row lost its slot to the blank line.
      expect(result.events).toHaveLength(3999);
      expect(result.events[0]!.content).toBe("e1");
      expect(result.events.at(-1)!.content).toBe("e3999");
    } finally {
      await teardown();
    }
  });

  it("windowed tail of a large above-cap wire log matches a whole-file parse", async () => {
    const { registry, logs, teardown } = setup();
    try {
      registry.create("ws1", "run-1");
      // ~8MB of ~270B rows: the 4MB probe window holds far more than cap(400)
      // lines, so the read serves from a window whose start cuts a row mid-line.
      const lines: string[] = [];
      for (let i = 0; i < 30_000; i += 1) {
        lines.push(wireRow(i, 100 + (i % 100)));
        if (i > 0 && i < 25_000 && i % 5_000 === 0) lines.push("");
      }
      lines.push('{"seq":99999,"torn'); // torn tail line, tolerated like any other
      writeFileSync(logs.wireLogPath("Lane"), lines.join("\n") + "\n", "utf-8");

      const service = new ArenaLogsService({ workspaceRegistry: registry });
      const result = service.columnLogs("ws1", "Lane");
      const reference = wholeFileTail(logs.wireLogPath("Lane"), 400);
      expect(result.truncated).toBe(true);
      expect(result.wire).toEqual(reference.rows);
      // Last cap window = torn line + 399 valid rows (blank lines sit before it).
      expect(result.wire).toHaveLength(399);
      expect(result.wire[0]!.seq).toBe(29_601);
    } finally {
      await teardown();
    }
  });

  it("expands the read window to the whole file when a large log stays under the cap", async () => {
    const { registry, logs, teardown } = setup();
    try {
      registry.create("ws1", "run-1");
      // 300 rows of ~20KB ≈ 6MB: under cap(400) but larger than the probe window,
      // so the reader must widen back to the file start and keep every row.
      const lines: string[] = [];
      for (let i = 0; i < 300; i += 1) lines.push(wireRow(i, 20_000));
      writeFileSync(logs.wireLogPath("Lane"), lines.join("\n") + "\n", "utf-8");

      const service = new ArenaLogsService({ workspaceRegistry: registry });
      const result = service.columnLogs("ws1", "Lane");
      expect(result.truncated).toBe(false);
      expect(result.wire).toHaveLength(300);
      expect(result.wire[0]!.seq).toBe(0);
      expect(result.wire.at(-1)!.seq).toBe(299);
    } finally {
      await teardown();
    }
  });

  it("treats empty and blank-only files as zero rows, never truncation", async () => {
    const { registry, logs, teardown } = setup();
    try {
      registry.create("ws1", "run-1");
      const service = new ArenaLogsService({ workspaceRegistry: registry });
      const file = logs.eventLogPath("Lane");

      writeFileSync(file, "", "utf-8");
      const empty = service.columnLogs("ws1", "Lane");
      expect(empty.events).toHaveLength(0);
      expect(empty.truncated).toBe(false);

      writeFileSync(file, "\n\n", "utf-8");
      const blank = service.columnLogs("ws1", "Lane");
      expect(blank.events).toHaveLength(0);
      expect(blank.truncated).toBe(false);
    } finally {
      await teardown();
    }
  });

  it("parses BOM-prefixed and CRLF-terminated rows written by external editors", async () => {
    const { registry, logs, teardown } = setup();
    try {
      registry.create("ws1", "run-1");
      const file = logs.eventLogPath("Lane");
      writeFileSync(
        file,
        `\uFEFF${JSON.stringify(thoughtEvent(1, "a"))}\r\n${JSON.stringify(thoughtEvent(2, "b"))}\r\n`,
        "utf-8",
      );
      const service = new ArenaLogsService({ workspaceRegistry: registry });
      expect(service.columnLogs("ws1", "Lane").events.map((event) => event.content)).toEqual(["a", "b"]);
    } finally {
      await teardown();
    }
  });

  it("skips a torn line mid-file (merged with the next append) without poisoning the rest", async () => {
    const { registry, logs, teardown } = setup();
    try {
      registry.create("ws1", "run-1");
      const file = logs.eventLogPath("Lane");
      // A torn append without its newline merges with the next append's bytes,
      // so the tear can sit anywhere, not just at the physical tail.
      writeFileSync(
        file,
        [
          JSON.stringify(thoughtEvent(1, "a")),
          `{"type":"thought_del${JSON.stringify(thoughtEvent(2, "b"))}`,
          JSON.stringify(thoughtEvent(3, "c")),
          "",
        ].join("\n"),
        "utf-8",
      );
      const service = new ArenaLogsService({ workspaceRegistry: registry });
      const result = service.columnLogs("ws1", "Lane");
      expect(result.events.map((event) => event.content)).toEqual(["a", "c"]);
      expect(result.truncated).toBe(false);
    } finally {
      await teardown();
    }
  });

  it("returns one oversized line without a trailing newline whole", async () => {
    const { registry, logs, teardown } = setup();
    try {
      registry.create("ws1", "run-1");
      const big = "x".repeat(1_000_000);
      writeFileSync(logs.eventLogPath("Lane"), JSON.stringify(thoughtEvent(1, big)), "utf-8");
      const service = new ArenaLogsService({ workspaceRegistry: registry });
      expect(service.columnLogs("ws1", "Lane").events[0]!.content).toHaveLength(1_000_000);
    } finally {
      await teardown();
    }
  });

  it("keeps same-file appends in submission order while two columns interleave writes", async () => {
    const { registry, logs, teardown } = setup();
    try {
      registry.create("ws1", "run-1");
      // Two columns append concurrently to distinct files; each file must read
      // back in exact submission order (fs thread-pool writes are unordered).
      const total = 200;
      for (let i = 0; i < total; i += 1) {
        logs.appendEvent("LaneA", thoughtEvent(i + 1, `a${i}`));
        logs.appendEvent("LaneB", thoughtEvent(i + 1, `b${i}`));
      }
      await logs.flush();
      const order = (file: string): string[] =>
        readFileSync(file, "utf-8")
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => (JSON.parse(line) as { content: string }).content);
      expect(order(logs.eventLogPath("LaneA"))).toEqual(Array.from({ length: total }, (_, i) => `a${i}`));
      expect(order(logs.eventLogPath("LaneB"))).toEqual(Array.from({ length: total }, (_, i) => `b${i}`));
    } finally {
      await teardown();
    }
  });
});
