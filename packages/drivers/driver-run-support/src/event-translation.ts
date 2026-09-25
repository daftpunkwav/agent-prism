/**
 * @file event-translation
 * @description Shared LC/LG translation onto the unified ArenaEvent stream.
 *
 * Responsibilities:
 * - Map astream_events v2 raw events onto ArenaEvents via a per-column RunState
 * - Translate harness control events and tool outcome events
 * - Own stream emission and terminal event finishing
 *
 * One translation layer shared by the LangChain and LangGraph drivers.
 */

import type { ArenaEvent, Clock, ToolExecutionResult } from "@agentprism/contracts";
import { OBSERVATION_MAX_CHARS, completeEvent, lowerAskUserKeys, normalizeAskUserBatchArgs, normalizeAskUserOptions, tokenUpdateEvent } from "@agentprism/contracts";
import { buildMetrics, type TokenTracker } from "@agentprism/telemetry";
import { extractLlmUsage } from "@agentprism/harness";
import { extractChunkParts } from "@agentprism/contracts";

/** Per-column run state shared by the LangChain/LangGraph drivers. */
export interface RunState {
  label: string;
  started: number;
  step: number;
  /** LLM turns (incremented once per completed model call) — the unified unit for metrics.steps, same meaning as native turns. */
  turns: number;
  toolCalls: number;
  tracker: TokenTracker;
  clock: Clock;
  streamingStep: number | null;
  thinkingStep: number | null;
  /** Step number announced by on_chat_model_start; thinking/text chunks of that call attach to it without incrementing. */
  pendingStep: number | null;
  workspaceName: string;
}

/**
 * Creates per-run driver state (step/turn counters start at zero).
 *
 * @param label Pipeline label stamped onto emitted events.
 * @param tracker Token accountant shared with the execution context.
 * @param clock Time source for the run start stamp.
 * @returns Fresh mutable run state; drivers thread it through callbacks.
 */
export function createRunState(label: string, tracker: TokenTracker, clock: Clock): RunState {
  return {
    label,
    started: clock.now(),
    step: 0,
    turns: 0,
    toolCalls: 0,
    tracker,
    clock,
    streamingStep: null,
    thinkingStep: null,
    pendingStep: null,
    workspaceName: "",
  };
}

function normalizeArgs(input: unknown): Record<string, unknown> {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return { input };
}

/**
 * Resolves a model-cased tool name (ASK_USER/Ask_User) to the registry's canonical
 * lowercase entry. Returns the original name when no case-insensitive match exists
 * (callers then fail closed with unknown/unauthorized as before).
 */
export function canonicalToolName(names: ReadonlySet<string>, name: string): string {
  if (names.has(name)) return name;
  const lower = name.toLowerCase();
  for (const entry of names) {
    if (entry.toLowerCase() === lower) return entry;
  }
  return name;
}

/**
 * Normalizes ask_user action args to lowercase keys before emission, so every
 * frontend (including ones predating the case-tolerant modal parser) sees
 * `questions/id/header/question/options` and pops the per-column window instead
 * of leaving the run waiting with no UI (the LangChain "stuck" run).
 */
export function normalizeActionArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  if (toolName.toLowerCase() !== "ask_user") return args;
  const batch = normalizeAskUserBatchArgs(args ?? {});
  if (Array.isArray(batch.questions)) {
    batch.questions = (batch.questions as unknown[]).map((item) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
      const out = lowerAskUserKeys(item as Record<string, unknown>);
      if (out.options !== undefined) out.options = normalizeAskUserOptions(out.options);
      return out;
    });
  }
  return batch;
}

/**
 * Builds an event with shared defaults filled in (tests and drivers override per field).
 *
 * @param partial Event type plus pipeline (required); every other field optional.
 * @returns Complete ArenaEvent with zeroed/blank defaults for missing fields.
 */
export function eventOf(partial: Partial<ArenaEvent> & { type: ArenaEvent["type"]; pipeline: string }): ArenaEvent {
  return {
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
    turn: 0,
    runId: "",
    timestamp: 0,
    ...partial,
  } as ArenaEvent;
}

/**
 * file_diff / tool_progress after a tool execute — shared by Native, LangChain, and LangGraph.
 * Caller is responsible for the action/observation pair around these.
 */
export function emitToolOutcomeEvents(
  pipeline: string,
  workspaceName: string,
  step: number,
  toolName: string,
  outcome: Pick<ToolExecutionResult, "result" | "fileDiff">,
): ArenaEvent[] {
  const events: ArenaEvent[] = [];
  if (toolName === "bash") {
    const result = outcome.result;
    for (let i = 0; i < result.length; i += 400) {
      events.push(
        eventOf({
          type: "tool_progress",
          pipeline,
          step,
          content: result.slice(i, i + 400),
          workspace: workspaceName,
        }),
      );
    }
  }
  if (outcome.fileDiff !== null) {
    events.push(
      eventOf({
        type: "file_diff",
        pipeline,
        step,
        content: outcome.fileDiff,
        workspace: workspaceName,
      }),
    );
  }
  return events;
}

function thoughtEnd(state: RunState): ArenaEvent {
  const step = state.streamingStep ?? 0;
  state.streamingStep = null;
  state.thinkingStep = null;
  return eventOf({ type: "thought_end", pipeline: state.label, step, content: "" });
}


export interface StreamEventOptions {
  nodeName?: string;
  nodeStartExcluded?: ReadonlySet<string>;
}

/** Translates raw astream_events v2 events into ArenaEvents. */
export function emitStreamEvent(state: RunState, rawEvent: unknown, options: StreamEventOptions = {}): ArenaEvent[] {
  const event = (rawEvent ?? {}) as Record<string, unknown>;
  const kind = typeof event.event === "string" ? event.event : "";
  const data = (event.data ?? {}) as Record<string, unknown>;

  switch (kind) {
    case "on_chat_model_start":
      return onChatModelStart(state, data);
    case "on_chat_model_stream":
      return onChatModelStream(state, data);
    case "on_chat_model_end":
      return onChatModelEnd(state, data);
    case "on_tool_start":
      return onToolStart(state, data, event, options.nodeName ?? "");
    case "on_tool_end":
      return onToolEnd(state, data);
    case "on_node_start":
      return onNodeStart(state, options.nodeName ?? "", options.nodeStartExcluded ?? new Set());
    default:
      return [];
  }
}

/** Model call started: announce the step before the first token so buffered providers never leave the column silent. */
function onChatModelStart(state: RunState, _data: Record<string, unknown>): ArenaEvent[] {
  const events: ArenaEvent[] = [];
  if (state.streamingStep !== null) {
    events.push(thoughtEnd(state));
  }
  state.thinkingStep = null;
  state.step += 1;
  state.pendingStep = state.step;
  events.push(eventOf({ type: "step_start", pipeline: state.label, step: state.step }));
  return events;
}

function onChatModelStream(state: RunState, data: Record<string, unknown>): ArenaEvent[] {
  const events: ArenaEvent[] = [];
  const label = state.label;
  const { thinking, text } = extractChunkParts(data.chunk);
  if (thinking !== "") {
    if (state.thinkingStep === null) {
      state.thinkingStep = state.pendingStep ?? (state.step += 1);
    }
    events.push(eventOf({ type: "thinking", pipeline: label, step: state.thinkingStep, content: thinking }));
  }
  if (text !== "") {
    if (state.streamingStep === null) {
      state.streamingStep = state.pendingStep ?? (state.step += 1);
    }
    events.push(eventOf({ type: "thought_delta", pipeline: label, step: state.streamingStep, content: text }));
  }
  return events;
}

function onChatModelEnd(state: RunState, data: Record<string, unknown>): ArenaEvent[] {
  const events: ArenaEvent[] = [];
  // One completed model call = one turn, same accounting as the native driver's turns
  state.turns += 1;
  state.pendingStep = null;
  const usage = extractLlmUsage(data);
  if (usage !== null) {
    state.tracker.addUsage(usage);
    events.push(tokenUpdateEvent({ pipeline: state.label, token_stats: state.tracker.asDict(), workspace: state.workspaceName }));
  }
  if (state.streamingStep !== null) {
    events.push(thoughtEnd(state));
  }
  state.thinkingStep = null;
  return events;
}

function onToolStart(
  state: RunState,
  data: Record<string, unknown>,
  event: Record<string, unknown>,
  nodeName: string,
): ArenaEvent[] {
  const events: ArenaEvent[] = [];
  if (state.streamingStep !== null) {
    events.push(thoughtEnd(state));
  }
  state.thinkingStep = null;
  state.pendingStep = null;
  state.toolCalls += 1;
  state.step += 1;
  const toolName =
    (typeof data.name === "string" && data.name) ||
    (typeof event.name === "string" && event.name) ||
    nodeName ||
    "tool";
  events.push(
    eventOf({
      type: "action",
      pipeline: state.label,
      step: state.step,
      tool: toolName,
      args: normalizeActionArgs(toolName, normalizeArgs(data.input)),
      workspace: state.workspaceName,
    }),
  );
  return events;
}

/**
 * Renders LangChain tool output as text. Tool results may arrive as message
 * objects (e.g. ToolMessage with block content); blind String() would render
 * them as opaque `[object ToolMessage]` noise the model cannot learn from.
 */
function outputText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const content = record.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((block) => {
          if (typeof block === "string") return block;
          if (block !== null && typeof block === "object") {
            const text = (block as Record<string, unknown>).text;
            if (typeof text === "string") return text;
          }
          try {
            return JSON.stringify(block);
          } catch {
            return String(block);
          }
        })
        .join("\n");
    }
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}

function onToolEnd(state: RunState, data: Record<string, unknown>): ArenaEvent[] {
  state.step += 1;
  // Same truncation single source as the native driver (contracts/OBSERVATION_MAX_CHARS) to keep event sizes balanced across drivers
  const text = outputText(data.output).slice(0, OBSERVATION_MAX_CHARS);
  return [
    eventOf({
      type: "observation",
      pipeline: state.label,
      step: state.step,
      result: text,
      workspace: state.workspaceName,
    }),
  ];
}

function onNodeStart(state: RunState, nodeName: string, excluded: ReadonlySet<string>): ArenaEvent[] {
  if (nodeName === "" || excluded.has(nodeName)) return [];
  const events: ArenaEvent[] = [];
  if (state.streamingStep !== null) {
    events.push(thoughtEnd(state));
  }
  state.thinkingStep = null;
  state.pendingStep = null;
  events.push(eventOf({ type: "thought", pipeline: state.label, step: state.step, content: `[Phase: ${nodeName}]` }));
  return events;
}

/** Builds the complete event (shared by success/failure); the shape comes from the contracts factory. */
export function finishEvent(state: RunState, success: boolean): ArenaEvent {
  return completeEvent({
    pipeline: state.label,
    workspace: state.workspaceName,
    metrics: buildMetrics(state.tracker, {
      success,
      durationMs: state.clock.now() - state.started,
      toolCalls: state.toolCalls,
      // All three drivers report step counts in the LLM-turn unit
      steps: state.turns,
    }),
    timestamp: state.clock.now(),
  });
}
