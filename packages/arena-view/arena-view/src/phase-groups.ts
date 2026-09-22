/**
 * @file phase-groups
 * @description Groups display segments into human-readable work phases.
 *
 * Responsibilities:
 * - Categorize segments (thinking / read / write / code / plan / net / agent / ask)
 * - Fold consecutive same-category segments into one phase with per-tool counts
 * - Compute phase duration from segment timestamps when present
 *
 * Currently has no app consumer (the Builder chat renders flat per-step rows
 * now); kept as the phase-summary utility over display segments, with its
 * folding behavior locked by tests. Tool categories intentionally match the
 * Arena TraceView classification.
 */

import type { DisplaySegment } from "./trace-events.js";

export type PhaseCategory =
  | "thinking"
  | "read"
  | "write"
  | "code"
  | "plan"
  | "net"
  | "agent"
  | "ask"
  | "error"
  | "other"
  | "answer";

const READ_TOOLS = new Set(["read", "ls", "glob", "grep", "symbols"]);
const WRITE_TOOLS = new Set(["write", "edit", "apply_patch"]);
const CODE_TOOLS = new Set(["run", "run_job", "bash_session"]);
const PLAN_TOOLS = new Set(["todo_write", "plan", "goal", "ralph_loop"]);
const NET_TOOLS = new Set(["webfetch", "web_search"]);
const AGENT_TOOLS = new Set(["subagent", "skill", "session_query", "scatter"]);

/** Maps a tool name to its phase category (mirrors the Arena TraceView classification). */
export function phaseCategoryOfTool(tool: string): Exclude<PhaseCategory, "thinking" | "answer"> {
  const name = tool.toLowerCase();
  if (READ_TOOLS.has(name)) return "read";
  if (WRITE_TOOLS.has(name)) return "write";
  if (CODE_TOOLS.has(name)) return "code";
  if (name === "ask_user") return "ask";
  if (PLAN_TOOLS.has(name)) return "plan";
  if (NET_TOOLS.has(name)) return "net";
  if (AGENT_TOOLS.has(name)) return "agent";
  return "other";
}

/** One tool invocation count inside a phase (insertion-ordered). */
export interface PhaseToolCount {
  tool: string;
  count: number;
}

/** A run's work folded into one human-readable phase row. */
export interface PhaseGroup {
  id: string;
  category: PhaseCategory;
  /** Segment ids belonging to the phase (for expanding back to details). */
  segmentIds: string[];
  /** Per-tool invocation counts (tool phases only, insertion-ordered). */
  tools: PhaseToolCount[];
  /** Number of folded thinking segments (thinking phases). */
  thinkingCount: number;
  /** First-event → last-event duration when timestamps exist; null otherwise. */
  durationMs: number | null;
  /** True when the phase carries the turn's final answer segment. */
  final: boolean;
  /** Multi-agent identity (framework drivers); undefined for single-agent flows. */
  actor?: string;
}

interface MutablePhase extends Omit<PhaseGroup, "durationMs"> {
  tsMin?: number;
  tsMax?: number;
}

function segmentCategory(seg: DisplaySegment): PhaseCategory {
  if (seg.kind === "thinking" || seg.kind === "thought") return seg.final === true ? "answer" : "thinking";
  if (seg.kind === "error") return "error";
  if (seg.kind === "action" || seg.kind === "observation" || seg.kind === "tool_progress" || seg.kind === "file_diff") {
    return phaseCategoryOfTool(seg.tool ?? "");
  }
  return "other";
}

/** Folds consecutive same-category segments into phases; the final answer is always its own phase. */
export function groupPhases(segments: readonly DisplaySegment[]): PhaseGroup[] {
  const mutable: MutablePhase[] = [];
  for (const seg of segments) {
    if (seg.meta === true) continue;
    // Settled step markers are pure position ticks (SegmentRow hides them too):
    // folding them would paint a meaningless "steps" row per model call. Only a
    // pending marker at the live tail still carries information.
    if (seg.kind === "step" && seg.completed !== false) continue;
    const category = segmentCategory(seg);
    const prev = mutable[mutable.length - 1];
    let phase: MutablePhase;
    // A different multi-agent actor always opens a new phase: folding a coder's
    // work and a reviewer's work into one row would hide who did what.
    if (
      prev !== undefined &&
      prev.category === category &&
      category !== "answer" &&
      prev.actor === seg.actor
    ) {
      phase = prev;
    } else {
      phase = {
        id: `phase-${mutable.length + 1}`,
        category,
        segmentIds: [],
        tools: [],
        thinkingCount: 0,
        final: false,
        actor: seg.actor,
      };
      mutable.push(phase);
    }
    phase.segmentIds.push(seg.id);
    if (seg.kind === "thinking" || seg.kind === "thought") phase.thinkingCount += 1;
    if (seg.final === true) phase.final = true;
    const tool = seg.tool ?? "";
    if (tool !== "") {
      const last = phase.tools[phase.tools.length - 1];
      if (last !== undefined && last.tool === tool) last.count += 1;
      else phase.tools.push({ tool, count: 1 });
    }
    if (seg.tsStart !== undefined && (phase.tsMin === undefined || seg.tsStart < phase.tsMin)) {
      phase.tsMin = seg.tsStart;
    }
    if (seg.tsEnd !== undefined && (phase.tsMax === undefined || seg.tsEnd > phase.tsMax)) {
      phase.tsMax = seg.tsEnd;
    }
  }
  return mutable.map(({ tsMin, tsMax, ...rest }) => ({
    ...rest,
    durationMs: tsMin !== undefined && tsMax !== undefined ? Math.max(0, tsMax - tsMin) : null,
  }));
}
