/**
 * @file trace-events
 * @description Single source mapping the Arena event stream to display semantics.
 *
 * Responsibilities:
 * - Define mergeEvents: banner filtering, thought_delta accumulation, observation
 *   folding into their action, step_start pending markers
 * - Define buildTraceComparison: cross-column answer / tool-sequence / file comparison
 *
 * Pure and React-free so TraceView/TraceDiff consume one tested implementation;
 * SSE display semantics live exactly once here.
 */

import type { ArenaEvent } from "@agentprism/contracts";
import { isForeignPipelineConfigBanner, isPipelineConfigBanner, PIPELINE_BANNER_PREFIXES } from "@agentprism/contracts";

/** Display segment kinds (step = an LLM call announced by step_start; harness_edit = self-evolving prompt modification marker). */
export type SegmentKind =
  | "thought"
  | "thinking"
  | "step"
  | "action"
  | "observation"
  | "error"
  | "verify"
  | "reflect"
  | "harness_edit"
  | "tool_progress"
  | "file_diff";

export interface DisplaySegment {
  id: string;
  kind: SegmentKind;
  step: number;
  turn: number;
  text: string; // full text (deltas accumulate as thought streams in)
  tool?: string;
  args?: Record<string, unknown>;
  /** Tool output folded into the action segment (observation / streamed tool_progress). */
  result?: string;
  /** False while the folded tool output is still streaming (tool_progress without observation yet). */
  resultDone?: boolean;
  /** file_diff content folded into the action segment that produced it. */
  diff?: string;
  /** Config-banner thought (rendered compactly, not as agent reasoning). */
  meta?: boolean;
  completed: boolean; // true for terminal states such as thought_end / action / observation
  /** Event timestamps (ms epoch) bounding this segment, when events carry them (phase durations). */
  tsStart?: number;
  tsEnd?: number;
  /**
   * True on each turn's last settled thought segment: that text is the model's final
   * reply for the turn, not an interim reasoning step. Every other thought segment is
   * an interim step output (ToT candidates, reflections, self-critique) and renders
   * visually distinct from the reply. While a turn is still streaming, its last
   * segment stays unmarked (finality is only knowable once later steps appear or
   * the run settles).
   */
  final?: boolean;
}

/** Event turn. The contract (ArenaEventBase) guarantees all variants carry step/turn; 0 = unannotated. */
export function eventTurn(event: ArenaEvent): number {
  return event.turn ?? 0;
}

/** Incrementally merges events into segments: one timeline row per agent action. */
export function mergeEvents(events: ArenaEvent[], frameworkId?: string): DisplaySegment[] {
  const segs: DisplaySegment[] = [];
  // Config banners and streamed answers use separate keys so a step-number collision
  // cannot splice metadata into Step 1
  const segIndex = new Map<string, number>();
  // Index of the action segment that following observation / tool_progress / file_diff
  // events fold into; cleared by any LLM-side event (a new call owns the timeline next)
  let openActionIdx: number | null = null;
  // Sticky producing-tool name for orphan observations (stray output without a paired action)
  let lastTool = "";
  for (const ev of events) {
    const step = ev.step ?? 0;
    const turn = eventTurn(ev);
    const ts = ev.timestamp || undefined;
    const prevLen = segs.length;
    const key = `${turn}:${ev.type}:${step}`;
    if (ev.type === "step_start") {
      openActionIdx = null;
      const pendingKey = `stepstart:${turn}:${step}`;
      if (segIndex.has(pendingKey)) continue;
      segs.push({
        id: `t:step:${segs.length}`,
        kind: "step",
        step,
        turn,
        text: "",
        completed: false,
      });
      segIndex.set(pendingKey, segs.length - 1);
    } else if (ev.type === "thought") {
      openActionIdx = null;
      settlePendingStep(segIndex, segs, turn, step);
      if (isForeignPipelineConfigBanner(ev.content, frameworkId)) {
        continue;
      }
      const metaKey = `meta:${turn}`;
      const streamKey = `stream:${turn}:${step}`;
      const s: DisplaySegment = {
        id: `t:thought:${segs.length}`,
        kind: "thought",
        step,
        turn,
        text: ev.content || "",
        completed: true,
        meta: isPipelineConfigBanner(ev.content) || undefined,
      };
      segs.push(s);
      if (isPipelineConfigBanner(ev.content)) {
        segIndex.set(metaKey, segs.length - 1);
      } else {
        segIndex.set(streamKey, segs.length - 1);
      }
    } else if (ev.type === "thought_delta") {
      openActionIdx = null;
      settlePendingStep(segIndex, segs, turn, step);
      const chunk = ev.content || "";
      if (!chunk) continue;
      if (isForeignPipelineConfigBanner(chunk, frameworkId)) {
        continue;
      }
      if (isPipelineConfigBanner(chunk)) {
        const metaKey = `meta:${turn}`;
        const s: DisplaySegment = {
          id: `t:thought:${segs.length}`,
          kind: "thought",
          step,
          turn,
          text: chunk,
          completed: true,
          meta: true,
          tsStart: ts,
          tsEnd: ts,
        };
        segs.push(s);
        segIndex.set(metaKey, segs.length - 1);
        continue;
      }
      const streamKey = `stream:${turn}:${step}`;
      const idx = segIndex.get(streamKey);
      if (idx !== undefined && segs[idx]!.kind === "thought" && !segs[idx]!.completed) {
        segs[idx]!.text += chunk;
        if (ts !== undefined) segs[idx]!.tsEnd = ts;
      } else {
        const s: DisplaySegment = {
          id: `t:thought:${segs.length}`,
          kind: "thought",
          step,
          turn,
          text: chunk,
          completed: false,
        };
        segs.push(s);
        segIndex.set(streamKey, segs.length - 1);
      }
    } else if (ev.type === "thought_end") {
      const streamKey = `stream:${turn}:${step}`;
      const idx = segIndex.get(streamKey);
      if (idx !== undefined && segs[idx]!.kind === "thought" && !segs[idx]!.completed) {
        segs[idx]!.completed = true;
      }
    } else if (ev.type === "thinking") {
      openActionIdx = null;
      settlePendingStep(segIndex, segs, turn, step);
      // Model's inner monologue: kept separate from the visible answer so runaway thinking is never mistaken for the final answer
      const thinkKey = `thinking:${turn}:${step}`;
      const idx = segIndex.get(thinkKey);
      if (idx !== undefined && segs[idx]!.kind === "thinking") {
        segs[idx]!.text += ev.content || "";
        if (ts !== undefined) segs[idx]!.tsEnd = ts;
      } else {
        const s: DisplaySegment = {
          id: `t:thinking:${segs.length}`,
          kind: "thinking",
          step,
          turn,
          text: ev.content || "",
          completed: true,
        };
        segs.push(s);
        segIndex.set(thinkKey, segs.length - 1);
      }
    } else if (ev.type === "action") {
      settlePendingStep(segIndex, segs, turn, step);
      segs.push({
        id: key + ":" + segs.length,
        kind: "action",
        step,
        turn,
        text: "",
        tool: ev.tool,
        args: ev.args,
        result: "",
        resultDone: true,
        completed: true,
      });
      openActionIdx = segs.length - 1;
      lastTool = ev.tool ?? "";
    } else if (ev.type === "observation") {
      if (openActionIdx !== null) {
        const action = segs[openActionIdx]!;
        action.result = (action.result ?? "") + (ev.result || "");
        action.resultDone = true;
        if (ts !== undefined) action.tsEnd = ts;
        // One observation completes the call; a later observation is a stray and must stay standalone
        openActionIdx = null;
        continue;
      }
      segs.push({
        id: key + ":" + segs.length,
        kind: "observation",
        step,
        turn,
        text: ev.result || "",
        tool: lastTool,
        completed: true,
      });
    } else if (ev.type === "tool_progress") {
      const progKey = `tool_progress:${turn}:${step}`;
      if (openActionIdx !== null) {
        const action = segs[openActionIdx]!;
        action.result = (action.result ?? "") + (ev.content || "");
        action.resultDone = false;
        if (ts !== undefined) action.tsEnd = ts;
        continue;
      }
      const idx = segIndex.get(progKey);
      if (idx !== undefined && segs[idx]!.kind === "tool_progress") {
        segs[idx]!.text += ev.content || "";
      } else {
        const s: DisplaySegment = {
          id: `t:prog:${segs.length}`,
          kind: "tool_progress",
          step,
          turn,
          text: ev.content || "",
          completed: false,
        };
        segs.push(s);
        segIndex.set(progKey, segs.length - 1);
      }
    } else if (ev.type === "file_diff") {
      if (openActionIdx !== null) {
        const action = segs[openActionIdx]!;
        action.diff = (action.diff ?? "") + (ev.content || "");
        continue;
      }
      segs.push({
        id: key + ":" + segs.length,
        kind: "file_diff",
        step,
        turn,
        text: ev.content || "",
        completed: true,
      });
    } else if (ev.type === "error") {
      openActionIdx = null;
      settlePendingStep(segIndex, segs, turn, step);
      segs.push({
        id: key + ":" + segs.length,
        kind: "error",
        step,
        turn,
        text: ev.message || "",
        completed: true,
      });
    } else if (ev.type === "verify" || ev.type === "reflect" || ev.type === "harness_edit") {
      openActionIdx = null;
      settlePendingStep(segIndex, segs, turn, step);
      segs.push({
        id: key + ":" + segs.length,
        kind: ev.type,
        step,
        turn,
        text: ev.content || "",
        completed: true,
      });
    }
    // Stamp created segments with the event time (streaming folds updated tsEnd above)
    if (segs.length > prevLen) {
      for (let i = prevLen; i < segs.length; i += 1) {
        const seg = segs[i]!;
        if (seg.tsStart === undefined) seg.tsStart = ts;
        if (ts !== undefined) seg.tsEnd = ts;
      }
    } else if (openActionIdx !== null && ts !== undefined) {
      segs[openActionIdx]!.tsEnd = ts;
    }
    // Ignore pure metadata such as complete / token_update / report
  }
  markFinalAnswerSegments(segs);
  return segs;
}

/**
 * Marks each turn's last settled thought segment as the final reply (`final: true`).
 * Runs after the merge pass so renderers get one authoritative flag instead of
 * re-deriving "which answer block is the reply" in every consumer (TraceView
 * today; any future renderer reading segments, such as a judging preview).
 */
function markFinalAnswerSegments(segs: DisplaySegment[]): void {
  const lastSettledThought = new Map<number, number>();
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i]!;
    if (seg.kind === "thought" && !seg.meta && seg.completed && seg.text.trim() !== "") {
      lastSettledThought.set(seg.turn, i);
    }
  }
  for (const idx of lastSettledThought.values()) {
    segs[idx]!.final = true;
  }
}

/** Marks the pending step_start marker for (turn, step) settled: real content now represents this step. */
function settlePendingStep(
  segIndex: Map<string, number>,
  segs: DisplaySegment[],
  turn: number,
  step: number,
): void {
  const pendingKey = `stepstart:${turn}:${step}`;
  const idx = segIndex.get(pendingKey);
  if (idx !== undefined && segs[idx]!.kind === "step" && !segs[idx]!.completed) {
    segs[idx]!.completed = true;
  }
}

/** One parsed `key=value` field of a driver config banner. */
export interface ParsedBannerField {
  key: string;
  value: string;
}

/** Structured view of a driver Step-0 config banner: framework + mode labels + config fields. */
export interface ParsedBanner {
  /** Framework display name without brackets (e.g. "Native Agent"). */
  framework: string;
  /** Segments without `=` (e.g. "Tool Calling", "ReAct loop"). */
  modes: string[];
  /** Segments shaped as `key=value` in banner order. */
  fields: ParsedBannerField[];
}

/**
 * Parses a driver config banner (`[Prefix] mode · key=value · …`) into a
 * structured view for chip/table rendering. Returns null for non-banners.
 * Values keep parenthetical notes (e.g. `context=sliding(real trim)`) verbatim.
 */
export function parsePipelineBanner(content: string | undefined | null): ParsedBanner | null {
  if (!isPipelineConfigBanner(content)) return null;
  const trimmed = (content ?? "").trimStart();
  const prefix = PIPELINE_BANNER_PREFIXES.find((candidate) => trimmed.startsWith(candidate));
  const framework = prefix ? prefix.replace(/^\[/, "").replace(/\]$/, "") : "";
  const rest = prefix ? trimmed.slice(prefix.length).trim() : trimmed;
  const modes: string[] = [];
  const fields: ParsedBannerField[] = [];
  for (const segment of rest.split("·")) {
    const part = segment.trim();
    if (part === "") continue;
    const eq = part.indexOf("=");
    if (eq > 0) {
      fields.push({ key: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim() });
    } else {
      modes.push(part);
    }
  }
  return { framework, modes, fields };
}

/** One column's comparison digest for the Trace diff view. */
export interface TraceCompareColumn {
  label: string;
  /** Final assistant answer of the last turn ("" when none). */
  finalAnswer: string;
  /** Ordered tool calls: name + short detail (path / command / first arg). */
  toolCalls: Array<{ tool: string; detail: string }>;
  /** Workspace paths touched by tools, in first-touch order. */
  files: string[];
  success: boolean;
  durationMs: number;
  totalTokens: number;
  toolCallCount: number;
}

/** Cross-column trace comparison payload (effective comparison, not per-step alignment). */
export interface TraceComparison {
  columns: TraceCompareColumn[];
  /** Length of the shared tool-call prefix across columns (columns.length when identical). */
  commonToolPrefix: number;
  /** Union of touched files with the columns that touched each. */
  files: Array<{ path: string; producedBy: string[] }>;
}

/** Argument keys considered when summarizing one tool call (first match wins). */
const TOOL_DETAIL_KEYS = ["path", "command", "query", "name", "code", "content", "task", "action", "job_id"] as const;

/** Counts array items for list-shaped tool args (todo_write/ask_user); null when absent. */
function countOf(args: Record<string, unknown>, key: string): number | null {
  const direct = args[key];
  if (Array.isArray(direct)) return direct.length;
  // Model-cased variants (QUESTIONS/TODOS): historic events may carry them.
  const upper = args[key.toUpperCase()];
  return Array.isArray(upper) ? upper.length : null;
}

/** Short single-line detail for a tool call (path / command / first scalar arg). */
function toolDetail(tool: string, args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  // List-shaped calls read better as counts than as blank rows (no scalar key matches).
  const toolLower = tool.toLowerCase();
  if (toolLower === "todo_write") {
    const count = countOf(args, "todos");
    if (count !== null) return `${count} todos`;
  }
  if (toolLower === "ask_user") {
    const count = countOf(args, "questions");
    if (count !== null) return `${count} question${count === 1 ? "" : "s"}`;
  }
  if (tool === "run_job") {
    const action = typeof args.action === "string" ? args.action : "";
    const target = typeof args.job_id === "string" && args.job_id !== "" ? args.job_id : "";
    if (action !== "") return target !== "" ? `${action} ${target}` : action;
  }
  for (const key of TOOL_DETAIL_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim() !== "") {
      const line = value.split("\n")[0] ?? value;
      return line.length > 80 ? line.slice(0, 80) + "…" : line;
    }
  }
  return "";
}

/**
 * Builds the cross-column comparison: final answers, ordered tool sequences, and
 * touched files. Deliberately not per-(turn,step) alignment — step numbers across
 * different drivers/models are not semantically comparable rows.
 */
export function buildTraceComparison(
  columns: Array<{
    label: string;
    events: ArenaEvent[];
    metrics?: { success: boolean; duration_ms: number; total_tokens: number };
    /** Framework id for foreign-banner filtering (ColumnState.frameworkId); omitted skips filtering. */
    frameworkId?: string;
  }>,
): TraceComparison {
  // metrics.success is required downstream: callers must pass settled columns only (a column
  // without terminal metrics has no known outcome; the `?? true` below must never meet one).
  const cols: TraceCompareColumn[] = columns.map(({ label, events, metrics, frameworkId }) => {
    const toolCalls: TraceCompareColumn["toolCalls"] = [];
    const files: string[] = [];
    for (const seg of mergeEvents(events, frameworkId)) {
      if (seg.kind !== "action") continue;
      toolCalls.push({ tool: seg.tool || "unknown", detail: toolDetail(seg.tool || "unknown", seg.args) });
      const path = seg.args?.path;
      if (typeof path === "string" && path !== "" && !files.includes(path)) {
        files.push(path);
      }
    }
    return {
      label,
      finalAnswer: extractLastThought(events),
      toolCalls,
      files,
      success: metrics?.success ?? true,
      durationMs: metrics?.duration_ms ?? 0,
      totalTokens: metrics?.total_tokens ?? 0,
      toolCallCount: toolCalls.length,
    };
  });

  // Shared prefix across ALL columns: clamp to the shortest sequence; a single-column
  // (or empty) input must terminate immediately, never walk an unbounded prefix
  const shortest = cols.length > 0 ? Math.min(...cols.map((c) => c.toolCalls.length)) : 0;
  let common = 0;
  outer: while (common < shortest) {
    for (let i = 1; i < cols.length; i++) {
      const a = cols[0]!.toolCalls[common];
      const b = cols[i]!.toolCalls[common];
      if (!a || !b || a.tool !== b.tool || a.detail !== b.detail) {
        break outer;
      }
    }
    common += 1;
  }

  const fileMap = new Map<string, string[]>();
  for (const col of cols) {
    for (const path of col.files) {
      const owners = fileMap.get(path) ?? [];
      owners.push(col.label);
      fileMap.set(path, owners);
    }
  }

  return {
    columns: cols,
    commonToolPrefix: common,
    files: Array.from(fileMap.entries()).map(([path, producedBy]) => ({ path, producedBy })),
  };
}

/** Last turn's final assistant text (display digest, not a judging input): unlike extractFinalAnswer
 * it is not scoped to one turn and never falls back to observations, so tool-only columns report "".
 * Lives here rather than reusing extractFinalAnswer because the contracts differ, not for imports
 * (both files already share the banner helpers). */
function extractLastThought(events: ArenaEvent[]): string {
  let last = "";
  let streaming = "";
  for (const ev of events) {
    if (ev.type === "thought") {
      if (isPipelineConfigBanner(ev.content)) continue;
      streaming = ev.content || "";
      last = streaming;
    } else if (ev.type === "thought_delta") {
      const chunk = ev.content || "";
      if (!chunk || (!streaming && isPipelineConfigBanner(chunk))) continue;
      streaming += chunk;
      last = streaming;
    } else if (ev.type === "thought_end") {
      streaming = "";
    }
  }
  return last.slice(-4000).trim();
}
