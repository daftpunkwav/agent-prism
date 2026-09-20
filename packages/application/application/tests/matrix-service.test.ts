/**
 * @file matrix-service test
 * @description Locks matrix cell orchestration: progress, judging, failure isolation.
 */
import { describe, expect, it, vi } from "vitest";
import type { ArenaEvent } from "@agentprism/contracts";
import { MatrixService } from "../src/matrix-service.js";

function thought(pipeline: string, content: string): ArenaEvent {
  return { type: "thought", pipeline, workspace: "w", content, tool: "", args: {}, result: "", step: 1, passed: null, reason: "", metrics: null, message: "", token_stats: null, turn: 1, agentId: "a", runId: "r", timestamp: 1 } as unknown as ArenaEvent;
}

function reportEvent(cells: Array<{ label: string; tokens: number; tools: number; steps: number }>): ArenaEvent {
  return {
    type: "report",
    pipeline: "system",
    workspace: "",
    content: JSON.stringify({
      dimension: "framework",
      question: "q",
      hard_metrics: {
        rows: cells.map((cell) => ({
          label: cell.label,
          duration_ms: 1,
          total_tokens: cell.tokens,
          tool_calls: cell.tools,
          steps: cell.steps,
          success: true,
        })),
      },
      columns: {},
      narrative: "n",
      ablation: {
        rows: cells.map((cell) => ({
          label: cell.label,
          tool_calls: cell.tools,
          mcp_calls: 0,
          mcp_share: 0,
          skill_reads: 0,
          delegations: 0,
          reflects: 0,
          observation_chars: 0,
          answer_chars: 0,
          judge_passed: null,
          success: true,
        })),
      },
    }),
    tool: "",
    args: {},
    result: "",
    step: 0,
    passed: null,
    reason: "",
    metrics: null,
    message: "",
    token_stats: null,
    turn: 0,
    agentId: "",
    runId: "",
    timestamp: 0,
  } as unknown as ArenaEvent;
}

function fakeArena(scenarios: Record<string, { events: ArenaEvent[]; results: Record<string, { passed: boolean }> }>) {
  return {
    listTemplates: vi.fn().mockReturnValue(
      Object.keys(scenarios).map((id) => ({
        id,
        question: `q-${id}`,
        suggested_dimension: "framework",
        suggested_selections: ["native"],
      })),
    ),
    run: vi.fn().mockImplementation(async function* (request: { question: string }) {
      const id = String(request.question).slice(2);
      const scenario = scenarios[id];
      if (scenario === undefined) throw new Error(`no scenario for ${id}`);
      yield* scenario.events;
    }),
    judge: vi.fn().mockImplementation((templateId: string, answers: Record<string, string>) => {
      const scenario = scenarios[templateId];
      if (scenario === undefined) throw new Error(`unknown template ${templateId}`);
      const results: Record<string, { passed: boolean; reason: string; details: string[] }> = {};
      for (const [label, verdict] of Object.entries(scenario.results)) {
        void answers;
        results[label] = { passed: verdict.passed, reason: "", details: [] };
      }
      return { template_id: templateId, template_name: templateId, judge_type: "keyword", results };
    }),
  };
}

describe("MatrixService", () => {
  it("scores cells with progress and one final report", async () => {
    const arena = fakeArena({
      t1: {
        events: [thought("a", "answer one"), reportEvent([{ label: "a", tokens: 120, tools: 3, steps: 2 }])],
        results: { a: { passed: true } },
      },
      t2: { events: [thought("b", "answer two")], results: { b: { passed: false } } },
    });
    const service = new MatrixService({ arena: arena as never, now: () => 7 });
    const items = [];
    for await (const item of service.runMatrix([{ template_id: "t1", selections: [] }, { template_id: "t2", selections: [] }])) {
      items.push(item);
    }
    const progresses = items.filter((item) => item.kind === "progress");
    expect(progresses.map((p) => p.kind === "progress" && `${p.template_id}:${p.status}`)).toEqual([
      "t1:started",
      "t1:scored",
      "t2:started",
      "t2:scored",
    ]);
    const report = items.find((item) => item.kind === "report");
    expect(report?.kind).toBe("report");
    if (report?.kind !== "report") throw new Error("missing report");
    expect(report.report.cells).toHaveLength(2);
    expect(report.report.cells[0]).toMatchObject({ template_id: "t1", score: { passed: 1, total: 1 } });
    expect(report.report.cells[0]).toMatchObject({ metrics: { total_tokens: 120, tool_calls: 3, steps: 2 } });
    expect(report.report.cells[0]?.ablation).toHaveLength(1);
    expect(report.report.cells[1]).toMatchObject({ metrics: null });
    expect(report.report.startedAt).toBe(7);
    expect(arena.run).toHaveBeenCalledTimes(2);
  });

  it("isolates unknown-template failures per cell", async () => {
    const arena = fakeArena({});
    const service = new MatrixService({ arena: arena as never, now: () => 0 });
    const items = [];
    for await (const item of service.runMatrix([{ template_id: "ghost", selections: [] }])) {
      items.push(item);
    }
    expect(items.some((item) => item.kind === "progress" && item.status === "failed")).toBe(true);
    const report = items.find((item) => item.kind === "report");
    expect(report?.kind).toBe("report");
    if (report?.kind !== "report") throw new Error("missing report");
    expect(report.report.cells).toEqual([]);
  });
});
