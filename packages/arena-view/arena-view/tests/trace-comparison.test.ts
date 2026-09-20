/**
 * @file trace-comparison tests
 * @description Locks cross-column digests: answers, tool sequences, shared prefixes.
 */

import { describe, expect, it } from "vitest";
import { PIPELINE_BANNER_PREFIX } from "@agentprism/contracts";
import type { ArenaEvent } from "@agentprism/contracts";
import { buildTraceComparison } from "@agentprism/arena-view";

/** Builds a minimal event carrying step/turn. */
function ev(type: ArenaEvent["type"], step: number, extra: Partial<ArenaEvent> = {}): ArenaEvent {
  return { type, pipeline: "c1", step, turn: 0, timestamp: 0, ...extra } as ArenaEvent;
}

describe("buildTraceComparison cross-column comparison", () => {
  it("collects per-column answers, ordered tool sequences, and touched files", () => {
    const a = [
      ev("step_start", 1),
      ev("thought_delta", 1, { content: "Answer A" }),
      ev("thought_end", 1),
      ev("action", 2, { tool: "write", args: { path: "a.py", content: "x" } }),
      ev("action", 3, { tool: "run", args: { command: "python a.py\nsecond line" } }),
    ];
    const b = [
      ev("thought_delta", 1, { content: "Answer B" }),
      ev("thought_end", 1),
      ev("action", 2, { tool: "write", args: { path: "b.py" } }),
    ];
    const cmp = buildTraceComparison([
      { label: "A", events: a, metrics: { success: true, duration_ms: 100, total_tokens: 10 } },
      { label: "B", events: b, metrics: { success: false, duration_ms: 200, total_tokens: 20 } },
    ]);
    expect(cmp.columns[0]!.finalAnswer).toBe("Answer A");
    expect(cmp.columns[1]!.finalAnswer).toBe("Answer B");
    expect(cmp.columns[0]!.toolCalls).toEqual([
      { tool: "write", detail: "a.py" },
      { tool: "run", detail: "python a.py" },
    ]);
    expect(cmp.columns[0]!.files).toEqual(["a.py"]);
    expect(cmp.columns[0]!.success).toBe(true);
    expect(cmp.columns[1]!.durationMs).toBe(200);
    expect(cmp.files).toEqual([{ path: "a.py", producedBy: ["A"] }, { path: "b.py", producedBy: ["B"] }]);
  });

  it("measures the shared tool-call prefix length", () => {
    const mk = (tool: string, path: string) => ev("action", 1, { tool, args: { path } });
    const cmp = buildTraceComparison([
      { label: "A", events: [mk("ls", "x"), mk("read", "x"), mk("write", "a")] },
      { label: "B", events: [mk("ls", "x"), mk("read", "x"), mk("write", "b")] },
      { label: "C", events: [mk("ls", "x"), mk("read", "x"), mk("run", "y")] },
    ]);
    expect(cmp.commonToolPrefix).toBe(2);
  });

  it("reports an identical prefix when columns make the same calls", () => {
    const shared = [ev("action", 1, { tool: "ls", args: { path: "." } })];
    const cmp = buildTraceComparison([
      { label: "A", events: shared },
      { label: "B", events: shared },
    ]);
    expect(cmp.commonToolPrefix).toBe(1);
  });

  it("handles columns without any tool calls", () => {
    const cmp = buildTraceComparison([
      { label: "A", events: [ev("thought_delta", 1, { content: "direct answer" })] },
      { label: "B", events: [ev("thought_delta", 1, { content: "also direct" })] },
    ]);
    expect(cmp.commonToolPrefix).toBe(0);
    expect(cmp.files).toHaveLength(0);
    expect(cmp.columns.every((c) => c.toolCallCount === 0)).toBe(true);
  });

  it("accepts frameworkId for banner filtering; digests stay banner-free either way", () => {
    const foreign = `${PIPELINE_BANNER_PREFIX.langchain} reasoning=react`;
    const events = [
      ev("thought", 0, { content: foreign }),
      ev("thought_delta", 1, { content: "Answer" }),
      ev("thought_end", 1),
      ev("action", 2, { tool: "read", args: { path: "a.py" } }),
    ];
    const cmp = buildTraceComparison([
      { label: "native-col", events, frameworkId: "native", metrics: { success: true, duration_ms: 10, total_tokens: 5 } },
    ]);
    expect(cmp.columns[0]!.finalAnswer).toBe("Answer");
    expect(cmp.columns[0]!.toolCalls).toEqual([{ tool: "read", detail: "a.py" }]);
    // Without frameworkId the same digest holds (filtering only affects thought segments,
    // which digests ignore); the parameter must never receive a display label.
    const unlabeled = buildTraceComparison([{ label: "native-col", events }]);
    expect(unlabeled.columns[0]!.finalAnswer).toBe("Answer");
  });

  it("terminates on single-column and empty inputs (unbounded prefix guard)", () => {
    expect(buildTraceComparison([{ label: "A", events: [ev("action", 1, { tool: "ls", args: { path: "." } })] }]).commonToolPrefix).toBe(1);
    expect(buildTraceComparison([])).toEqual({ columns: [], commonToolPrefix: 0, files: [] });
  });
});

describe("buildTraceComparison newer-tool details", () => {
  it("summarizes list-shaped and delegated calls instead of blank rows", () => {
    const calls = (tool: string, args: Record<string, unknown>) => ev("action", 1, { tool, args });
    const cmp = buildTraceComparison([
      {
        label: "A",
        events: [
          calls("todo_write", { todos: [{ content: "a", status: "pending" }, { content: "b", status: "done" }] }),
          calls("ask_user", { questions: [{ question: "q?" }] }),
          calls("subagent", { task: "research caching" }),
          calls("skill", { action: "read", name: "commit" }),
          calls("run_job", { action: "poll", job_id: "job-2" }),
          calls("bash_session", { action: "send", command: "npm test" }),
          calls("web_search", { query: "prism" }),
        ],
        metrics: { success: true, duration_ms: 10, total_tokens: 5 },
      },
    ]);
    expect(cmp.columns[0]!.toolCalls).toEqual([
      { tool: "todo_write", detail: "2 todos" },
      { tool: "ask_user", detail: "1 question" },
      { tool: "subagent", detail: "research caching" },
      { tool: "skill", detail: "commit" },
      { tool: "run_job", detail: "poll job-2" },
      { tool: "bash_session", detail: "npm test" },
      { tool: "web_search", detail: "prism" },
    ]);
  });
});
