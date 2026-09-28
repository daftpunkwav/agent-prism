/**
 * @file claude-driver
 * @description Claude Agent SDK driver: the Claude Code agent loop with Arena
 *              tools served over an in-process MCP server.
 *
 * Responsibilities:
 * - Resolve the column's Anthropic transport and the Claude Code CLI
 * - Run query() with the Arena tools and no Claude Code built-in tools
 * - Translate SDK messages (assistant/user/stream_event/result) into ArenaEvents
 *
 * The CLI owns the loop and its own model transport (this framework cannot run
 * on the injected LlmAdapter), so the column requires an Anthropic-format
 * endpoint and reports tokens from the SDK's own usage payload. Tools stay on
 * the shared guarded path through MCP, which is what makes the column comparable
 * on the tool dimension. Verification retries are owned by runVerificationLoop
 * outside drivers.
 *
 * Because the calls are the CLI's, the callbacks the other columns attach to their
 * chat model never fire here: endpoint health for this column is reported from the
 * CLI's own stream through `context.onModelCall` (see health.ts).
 */

import type { ArenaEvent, AgentDriver, ChatTurnMessage } from "@agentprism/contracts";
import {
  OBSERVATION_MAX_CHARS,
  PIPELINE_BANNER_PREFIX,
  arenaErrorEvent,
  sanitizeErrorMessage,
  tokenUpdateEvent,
} from "@agentprism/contracts";
import { buildHistoryMessages, buildSystemUser, recordAdapterUsage, type AgentExecutionContext } from "@agentprism/harness";
import {
  createRunState,
  emitToolOutcomeEvents,
  eventOf,
  finishEvent,
  formatCapabilityPluginIds,
  normalizeActionArgs,
  stepBudgetFor,
  type RunState,
} from "@agentprism/driver-run-support";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { classifyClaudeHealth } from "./health.js";
import { resolveClaudeCodePath } from "./cli-path.js";
import { claudeSubprocessEnv, resolveClaudeTransport } from "./endpoint.js";
import { arenaAllowedToolIds, createArenaMcpServer } from "./mcp-tools.js";

/** Loosely-typed view of one SDK content block (text / thinking / tool_use / tool_result). */
interface BlockLike {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
  name?: unknown;
  input?: unknown;
  content?: unknown;
  is_error?: unknown;
}

/** Loosely-typed view of one SDK message. */
interface MessageLike {
  type?: unknown;
  subtype?: unknown;
  message?: { content?: unknown } | undefined;
  event?: { type?: unknown; delta?: { type?: unknown; text?: unknown; thinking?: unknown } } | undefined;
  result?: unknown;
  usage?: unknown;
  errors?: unknown;
  /** The CLI's own result flag (snake_case in the stream). */
  is_error?: unknown;
  /** HTTP status of a failed request (api_retry system messages; null = no response). */
  error_status?: unknown;
  /** Rate-limit state for the subscription endpoints (rate_limit_event messages). */
  rate_limit_info?: { status?: unknown } | undefined;
}

/** Reads the content block array of a message (string content counts as one text block). */
function contentBlocks(value: unknown): BlockLike[] {
  if (typeof value === "string") return [{ type: "text", text: value }];
  if (!Array.isArray(value)) return [];
  return value.filter((block): block is BlockLike => block !== null && typeof block === "object");
}

/** Flattens a tool_result block's content into text. */
function toolResultText(block: BlockLike): string {
  const content = block.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const entry of content) {
    if (entry === null || typeof entry !== "object") continue;
    const text = (entry as BlockLike).text;
    if (typeof text === "string") parts.push(text);
  }
  return parts.join("");
}

/**
 * Renders the column's prior turns as a transcript block.
 *
 * The CLI takes either one prompt string or a stream of *user* messages, so it
 * cannot accept a seeded assistant transcript the way an in-process column does.
 * Prior turns therefore travel as text in front of this turn's request — the
 * stateless-API adaptation of the same history every other backend mounts as
 * real messages (same turn selection and skipping rules: buildHistoryMessages).
 * The block is omitted entirely for a first turn.
 */
function historyTranscript(history: ChatTurnMessage[] | undefined): string {
  const turns = buildHistoryMessages(history);
  if (turns.length === 0) return "";
  const lines: string[] = ["[Conversation so far]"];
  for (const turn of turns) {
    if (turn.role === "tool") {
      lines.push(`Tool result (${turn.name ?? "tool"}): ${turn.content}`);
      continue;
    }
    if (turn.role === "assistant") {
      if (turn.content !== "") lines.push(`Assistant: ${turn.content}`);
      for (const call of turn.toolCalls ?? []) {
        lines.push(`Assistant tool call: ${call.name} ${JSON.stringify(call.args ?? {})}`);
      }
      continue;
    }
    if (turn.role === "user" && turn.content !== "") lines.push(`User: ${turn.content}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

/** This turn's prompt: the assembled user part, preceded by the prior-turn transcript when there is one. */
export function promptWithHistory(user: string, history: ChatTurnMessage[] | undefined): string {
  const transcript = historyTranscript(history);
  return transcript === "" ? user : `${transcript}\n\n[Current request]\n${user}`;
}

/** Claude Agent SDK Driver: Claude Code loop + Arena tools over MCP. */
export class ClaudeAgentSdkDriver implements AgentDriver {
  readonly frameworkId = "claude_agent_sdk";
  readonly displayName = "Claude Agent SDK";

  async *run(context: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
    const { config, question, history, tracker, tools, workspace } = context;
    const label = config.label;
    const state = createRunState(label, tracker, context.clock);
    state.workspaceName = workspace.name;

    const { system, user } = buildSystemUser(context);
    tracker.seedPrompt(system, user);
    yield tokenUpdateEvent({ pipeline: label, token_stats: tracker.asDict(), workspace: state.workspaceName });

    // Endpoint health: the CLI makes this column's model calls itself, so it is the only
    // place that can observe them. Declared outside the try so the catch can tell whether
    // the terminal result already classified the outcome.
    let terminalReported = false;
    const reportHealth = (message: MessageLike): void => {
      // The CLI's terminal result is "accounted for" even when it classifies to nothing
      // (its own turn/budget caps): the catch below must not then report that as an
      // endpoint failure.
      if (message.type === "result") terminalReported = true;
      if (context.onModelCall === undefined) return;
      const outcome = classifyClaudeHealth({
        type: message.type,
        subtype: message.subtype,
        errorStatus: message.error_status,
        // The CLI's own result flag is `is_error` (snake_case); the classifier's
        // ClaudeHealthMessage.isError is its camelCase counterpart.
        isError: message.is_error,
        rateLimitStatus: message.rate_limit_info?.status,
      });
      if (outcome === null) return;
      context.onModelCall(outcome);
    };

    try {
      const transport = resolveClaudeTransport(context.llmVendor, config.model_id);
      const extra: ArenaEvent[] = [];
      const mcpServer = createArenaMcpServer(tools, {
        question,
        harness: config.harness,
        signal: context.signal,
        onOutcome: (name, outcome) => {
          state.toolCalls += 1;
          extra.push(...emitToolOutcomeEvents(label, state.workspaceName, state.step, name, outcome));
        },
      });
      const cliPath = resolveClaudeCodePath();
      const turnBudget = stepBudgetFor(config.max_steps);
      const abort = new AbortController();
      const forwardAbort = () => abort.abort();
      context.signal?.addEventListener("abort", forwardAbort, { once: true });
      // A run cancelled while this column was still starting up (the driver is
      // suspended at its first yield until the consumer pulls) has already
      // dispatched its abort event: the listener above never fires, so the CLI
      // would run the whole task for nobody. Same guard as the run helpers.
      if (context.signal?.aborted === true) abort.abort();

      yield eventOf({
        type: "thought",
        pipeline: label,
        workspace: state.workspaceName,
        step: 0,
        content:
          `${PIPELINE_BANNER_PREFIX.claude_agent_sdk} Claude Code loop + Arena tools over MCP · ` +
          `reasoning=${config.reasoning} · prompt=${config.prompt_profile} · ` +
          `harness=${config.harness} · model=${transport.model} · ` +
          `max_steps=${config.max_steps} · toolset=${config.toolset} · ` +
          `mcp=${String((config as Record<string, unknown>)["mcp_policy"] ?? "off")} · ` +
          `skill=${String((config as Record<string, unknown>)["skill_policy"] ?? "on_demand")} · ` +
          `orchestration=${String((config as Record<string, unknown>)["orchestration"] ?? "direct")} · ` +
          `history_mode=${String((config as Record<string, unknown>)["history_mode"] ?? "minimal")}` +
          ` · ${formatCapabilityPluginIds(config)}`,
        turn: context.turn,
        timestamp: context.clock.now(),
        agentId: context.identity.agentId,
      });

      const session = query({
        prompt: promptWithHistory(user, history),
        options: {
          model: transport.model,
          cwd: workspace.cwd(),
          systemPrompt: system,
          env: claudeSubprocessEnv(transport),
          mcpServers: { arena: mcpServer },
          // Built-ins off: the column compares on the shared Arena tool surface,
          // and Claude Code's own tools would write to the workspace unguarded.
          tools: [],
          allowedTools: arenaAllowedToolIds(tools),
          // Deny anything not pre-approved instead of prompting with no user to answer.
          permissionMode: "dontAsk",
          // The developer's own CLAUDE.md/settings must not leak into a comparison run.
          settingSources: [],
          includePartialMessages: true,
          abortController: abort,
          ...(cliPath !== undefined ? { pathToClaudeCodeExecutable: cliPath } : {}),
          ...(Number.isFinite(turnBudget) ? { maxTurns: turnBudget } : {}),
        },
      });

      try {
        // `sawText` gates the whole-message fallback (assistant text blocks would
        // duplicate deltas already delivered); `sawAnswerText` is the wider claim
        // "the latest content reached the thought channel as text", which the
        // result summary must not duplicate. A tool block after the last text
        // resets it: a turn that ended on pure tool use has its answer only in
        // the result summary, which must then fill the thought channel.
        let sawText = false;
        let sawAnswerText = false;
        for await (const raw of session) {
          for (const queued of extra.splice(0)) yield queued;
          const message = raw as MessageLike;
          reportHealth(message);
          switch (message.type) {
            case "stream_event": {
              const event = message.event;
              if (event?.type === "message_start") {
                if (state.streamingStep !== null) yield this.thoughtEnd(state);
                state.step += 1;
                state.turns += 1;
                state.streamingStep = state.step;
                yield eventOf({
                  type: "step_start",
                  pipeline: label,
                  step: state.step,
                  content: "",
                  workspace: state.workspaceName,
                });
                break;
              }
              if (event?.type === "content_block_delta") {
                const delta = event.delta;
                if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text !== "") {
                  sawText = true;
                  sawAnswerText = true;
                  yield eventOf({
                    type: "thought_delta",
                    pipeline: label,
                    step: state.streamingStep ?? state.step,
                    content: delta.text,
                    workspace: state.workspaceName,
                  });
                }
                if (delta?.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking !== "") {
                  yield eventOf({
                    type: "thinking",
                    pipeline: label,
                    step: state.streamingStep ?? state.step,
                    content: delta.thinking,
                    workspace: state.workspaceName,
                  });
                }
              }
              break;
            }
            case "assistant": {
              // Some deployments deliver whole assistant messages without partial
              // events; open a step here so the turn is still counted and its text
              // still reaches the answer channel.
              if (state.streamingStep === null) {
                state.step += 1;
                state.turns += 1;
                state.streamingStep = state.step;
                yield eventOf({
                  type: "step_start",
                  pipeline: label,
                  step: state.step,
                  content: "",
                  workspace: state.workspaceName,
                });
              }
              for (const block of contentBlocks(message.message?.content)) {
                if (block.type === "text" && !sawText && typeof block.text === "string" && block.text !== "") {
                  sawAnswerText = true;
                  yield eventOf({
                    type: "thought_delta",
                    pipeline: label,
                    step: state.streamingStep ?? state.step,
                    content: block.text,
                    workspace: state.workspaceName,
                  });
                }
                if (block.type === "tool_use") {
                  sawAnswerText = false;
                  yield this.thoughtEnd(state);
                  state.step += 1;
                  yield eventOf({
                    type: "action",
                    pipeline: label,
                    step: state.step,
                    tool: typeof block.name === "string" ? block.name : "",
                    args: normalizeActionArgs(
                      typeof block.name === "string" ? block.name : "",
                      (block.input ?? {}) as Record<string, unknown>,
                    ),
                    workspace: state.workspaceName,
                  });
                }
              }
              break;
            }
            case "user": {
              for (const block of contentBlocks(message.message?.content)) {
                if (block.type !== "tool_result") continue;
                sawAnswerText = false;
                const text = toolResultText(block);
                state.step += 1;
                yield eventOf({
                  type: "observation",
                  pipeline: label,
                  step: state.step,
                  result: text.slice(0, OBSERVATION_MAX_CHARS),
                  // MCP results carry the flag explicitly; absent means unknown.
                  ok: typeof block.is_error === "boolean" ? !block.is_error : undefined,
                  workspace: state.workspaceName,
                });
              }
              break;
            }
            case "result": {
              yield this.thoughtEnd(state);
              recordAdapterUsage(message.usage as Record<string, unknown> | undefined, tracker);
              yield tokenUpdateEvent({
                pipeline: label,
                token_stats: tracker.asDict(),
                workspace: state.workspaceName,
              });
              if (message.subtype !== "success" || message.is_error === true) {
                const errors = Array.isArray(message.errors) ? message.errors.join("; ") : "";
                throw new Error(
                  `Claude Agent SDK run failed (${String(message.subtype)})${errors !== "" ? `: ${errors}` : ""}`,
                );
              }
              if (!sawAnswerText && typeof message.result === "string" && message.result.trim() !== "") {
                // No text reached the thought channel at all: the run summary is the
                // only answer text. When assistant messages already carried it, the
                // summary would just repeat the answer in the transcript.
                yield eventOf({
                  type: "thought",
                  pipeline: label,
                  step: state.step,
                  content: message.result,
                  workspace: state.workspaceName,
                });
              }
              break;
            }
            default:
              break;
          }
        }
      } finally {
        context.signal?.removeEventListener("abort", forwardAbort);
      }
      for (const queued of extra.splice(0)) yield queued;

      yield finishEvent(state, true);
    } catch (error) {
      // Cancellation is not a column failure: the abort error leaves untouched,
      // exactly like every other backend's abort path (agent-execution owns the
      // cancelled terminal).
      if ((error as Error)?.name === "AbortError") throw error;
      // A driver-level throw without a classified result (spawn failure, stream error)
      // is a failed model transport for this column, so report it once.
      if (!terminalReported) context.onModelCall?.({ ok: false, error });
      // Server-side detail log; the client-facing event stays sanitized.
      console.error(`[claude-agent-sdk-driver] column "${label}" failed:`, error);
      yield arenaErrorEvent({
        pipeline: label,
        workspace: state.workspaceName,
        message: sanitizeErrorMessage(error),
        turn: context.turn,
        timestamp: context.clock.now(),
        agentId: context.identity.agentId,
      });
      yield finishEvent(state, false);
    }
  }

  /** Closes the streaming thought block; idempotent across message boundaries. */
  private thoughtEnd(state: RunState): ArenaEvent {
    const step = state.streamingStep ?? state.step;
    state.streamingStep = null;
    return eventOf({
      type: "thought_end",
      pipeline: state.label,
      step,
      content: "",
      workspace: state.workspaceName,
    });
  }
}
