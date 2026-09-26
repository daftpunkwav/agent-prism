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
 */

import type { ArenaEvent, AgentDriver } from "@agentprism/contracts";
import {
  OBSERVATION_MAX_CHARS,
  PIPELINE_BANNER_PREFIX,
  arenaErrorEvent,
  sanitizeErrorMessage,
  tokenUpdateEvent,
} from "@agentprism/contracts";
import { buildSystemUser, recordAdapterUsage, type AgentExecutionContext } from "@agentprism/harness";
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
  isError?: unknown;
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

/** Claude Agent SDK Driver: Claude Code loop + Arena tools over MCP. */
export class ClaudeAgentSdkDriver implements AgentDriver {
  readonly frameworkId = "claude_agent_sdk";
  readonly displayName = "Claude Agent SDK";

  async *run(context: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
    const { config, question, tracker, tools, workspace } = context;
    const label = config.label;
    const state = createRunState(label, tracker, context.clock);
    state.workspaceName = workspace.name;

    const { system, user } = buildSystemUser(context);
    tracker.seedPrompt(system, user);
    yield tokenUpdateEvent({ pipeline: label, token_stats: tracker.asDict(), workspace: state.workspaceName });

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
        prompt: user,
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
        let sawText = false;
        for await (const raw of session) {
          for (const queued of extra.splice(0)) yield queued;
          const message = raw as MessageLike;
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
                  yield eventOf({
                    type: "thought_delta",
                    pipeline: label,
                    step: state.streamingStep ?? state.step,
                    content: block.text,
                    workspace: state.workspaceName,
                  });
                }
                if (block.type === "tool_use") {
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
                const text = toolResultText(block);
                state.step += 1;
                yield eventOf({
                  type: "observation",
                  pipeline: label,
                  step: state.step,
                  result: text.slice(0, OBSERVATION_MAX_CHARS),
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
              if (message.subtype !== "success" || message.isError === true) {
                const errors = Array.isArray(message.errors) ? message.errors.join("; ") : "";
                throw new Error(
                  `Claude Agent SDK run failed (${String(message.subtype)})${errors !== "" ? `: ${errors}` : ""}`,
                );
              }
              if (!sawText && typeof message.result === "string" && message.result.trim() !== "") {
                // No streamed text at all: the run summary is the only answer text.
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
