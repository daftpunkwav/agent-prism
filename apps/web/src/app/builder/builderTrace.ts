/**
 * @file builderTrace
 * @description Pure display helpers for the builder observability panel.
 *
 * Responsibilities:
 * - Classify trace entry kinds into display metadata (icon label + accent color)
 * - Build one-line summaries for trace entries and arena events
 * - Shape LLM wire pairs (request + response) for the wire tab
 *
 * Pure and React-free: Display helpers delegating to arena-view/mergeEvents (single source of SSE display semantics).
 */

import type { ArenaEvent, BuilderChatMessage, BuilderTraceEntry, BuilderTraceRecord, LlmWireRequest, LlmWireResponse } from "@agentprism/client";
import { mergeEvents, type DisplaySegment } from "@agentprism/arena-view";
import type { ChatEntry } from "./ChatPanel";

/** Accent spectrum variable per trace kind (lane color conventions). */
export function traceAccent(kind: BuilderTraceEntry["kind"]): string {
  switch (kind) {
    case "llm_request":
      return "var(--spectrum-1)";
    case "llm_response":
      return "var(--spectrum-3)";
    case "llm_error":
      return "var(--destructive)";
    case "swap":
      return "var(--spectrum-5)";
    case "notice":
      return "var(--spectrum-2)";
    default:
      return "var(--muted-foreground)";
  }
}

/** One display row of the raw log: either a trace entry or a raw arena event. */
export type LogRow =
  | { source: "trace"; ts: number; label: string; detail: string; entry: BuilderTraceEntry }
  | { source: "event"; ts: number; label: string; detail: string; event: ArenaEvent };

/** Converts a trace entry into a log row (arrival order = array order). */
export function traceRow(entry: BuilderTraceEntry): LogRow {
  return { source: "trace", ts: entry.ts, label: entry.kind, detail: entry.title, entry };
}

/** Converts an arena event into a compact log row (the raw log stays faithful). */
export function eventRow(event: ArenaEvent): LogRow {
  const label = event.type;
  let detail = event.content || event.message || event.result || "";
  if (event.type === "action") {
    detail = `${event.tool}(${summarizeArgs(event.args)})`;
  } else if (event.type === "observation") {
    detail = `${event.tool} → ${truncate(event.result, 160)}`;
  } else if (event.type === "token_update") {
    detail = "token stats";
  } else {
    detail = truncate(detail, 160);
  }
  return { source: "event", ts: event.timestamp, label, detail, event };
}

/** One settled turn of the session journal: user message plus its raw events. */
export interface TurnGroup {
  turn: number;
  ts: number;
  user: string;
  events: ArenaEvent[];
}

/** Trace entries carried by journal records (the settled, persisted portion). */
export function persistedTraceEntries(records: BuilderTraceRecord[]): BuilderTraceEntry[] {
  return records.filter((record): record is Extract<BuilderTraceRecord, { kind: "trace" }> => record.kind === "trace").map((record) => record.entry);
}

/**
 * Merges persisted and live trace entries into one ordered list, deduped by id:
 * the journal already holds entries the live SSE stream is still delivering.
 */
export function mergedTraceEntries(persisted: BuilderTraceRecord[], live: BuilderTraceEntry[]): BuilderTraceEntry[] {
  const seen = new Set(persisted.map((record) => (record.kind === "trace" ? record.entry.id : "")));
  return [...persistedTraceEntries(persisted), ...live.filter((entry) => !seen.has(entry.id))];
}

/** Groups journal records into settled turns (user message + raw events, turn order). */
export function settledTurns(records: BuilderTraceRecord[]): TurnGroup[] {
  const turns: TurnGroup[] = [];
  const byTurn = new Map<number, TurnGroup>();
  for (const record of records) {
    if (record.kind === "turn") {
      const group: TurnGroup = { turn: record.turn, ts: record.ts, user: record.user, events: [] };
      turns.push(group);
      byTurn.set(record.turn, group);
    } else if (record.kind === "event") {
      byTurn.get(record.turn)?.events.push(record.event);
    }
  }
  return turns;
}

/**
 * Re-attaches each assistant bubble's collapsed work trail from the journal:
 * turn-numbered history messages get their turn's merged segments back, so a
 * reload or session switch keeps the trail instead of dropping it. Messages
 * without a turn number (pre-dating data, compacted pairs) pass through clean.
 */
export function attachTurnSegments(history: BuilderChatMessage[], records: BuilderTraceRecord[]): ChatEntry[] {
  const eventsByTurn = new Map<number, ArenaEvent[]>();
  for (const group of settledTurns(records)) {
    eventsByTurn.set(group.turn, group.events);
  }
  return history.map((message) => {
    const { turn } = message;
    if (message.role !== "assistant" || turn === undefined) {
      return { role: message.role, content: message.content };
    }
    const events = eventsByTurn.get(turn);
    const segments = events !== undefined ? mergeEvents(events) : undefined;
    return {
      role: message.role,
      content: message.content,
      ...(segments !== undefined && segments.length > 0 ? { segments } : {}),
    };
  });
}

/** Merges the accumulated arena events into display segments (banner-aware).
 * Deliberately unfiltered by framework: hot-swaps change frameworks between turns,
 * and filtering would hide earlier turns' banners from the session timeline.
 */
export function segmentsOf(events: ArenaEvent[]): DisplaySegment[] {
  return mergeEvents(events);
}

export interface LlmRound {
  request: BuilderTraceEntry | null;
  response: BuilderTraceEntry | null;
}

/** Groups the LLM wire stream into request/response rounds (error terminates a round). */
export function llmRounds(entries: BuilderTraceEntry[]): LlmRound[] {
  const rounds: LlmRound[] = [];
  let current: LlmRound | null = null;
  for (const entry of entries) {
    if (entry.kind === "llm_request") {
      current = { request: entry, response: null };
      rounds.push(current);
    } else if (entry.kind === "llm_response" || entry.kind === "llm_error") {
      if (current === null) {
        rounds.push({ request: null, response: entry });
      } else {
        current.response = entry;
        current = null;
      }
    }
  }
  return rounds;
}

/** Typed views of a trace entry's data payload (wire schemas are the truth). */
export function asRequest(entry: BuilderTraceEntry): LlmWireRequest {
  return entry.data as unknown as LlmWireRequest;
}

/** Typed view of a wire-response payload (`truncated` normalized to false when absent). */
export function asResponse(entry: BuilderTraceEntry): LlmWireResponse {
  const data = entry.data as Partial<LlmWireResponse> & { first_token_ms?: number | null };
  return { ...data, truncated: data.truncated ?? false } as LlmWireResponse;
}

/** First-token latency from a wire entry, or null when unrecorded. */
export function firstTokenMs(entry: BuilderTraceEntry): number | null {
  const value = (entry.data as { first_token_ms?: number | null }).first_token_ms;
  return typeof value === "number" ? value : null;
}

function summarizeArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return "";
  const head = keys[0] ?? "";
  return `${head}: ${truncate(JSON.stringify(args[head]) ?? "", 60)}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
