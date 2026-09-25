/**
 * @file autogen-driver
 * @description AutoGen-pattern framework driver: group chat with LLM speaker selection.
 *
 * Responsibilities:
 * - Pick the runtime per run: the Python framework bridge when the probe finds
 *   an interpreter with the autogen package, the pattern fallback otherwise
 * - Run coder/reviewer group-chat rounds; the user proxy executes tool calls
 * - Keep selections and critiques on reflect events; coder thoughts carry the answer
 * - Mirror a terminating reviewer verdict onto thoughts when the coder left no fresh answer
 * - Translate rounds/tools into the shared ArenaEvent stream
 *
 * Faithful-pattern implementation of AutoGen's conversable multi-agent group
 * chat on the arena's shared ports (same tools, workspace, telemetry); not
 * vendor code. max_steps budgets every group-chat LLM call (selection and
 * speaker turns alike). Verification retries are owned by runVerificationLoop
 * outside drivers. Reflexion grants one extra reviewer round.
 */

import type { AgentDriver, ArenaEvent, LlmAssistantMessage, LlmMessage, ToolDefinition } from "@agentprism/contracts";
import {
  PIPELINE_BANNER_PREFIX,
  arenaErrorEvent,
  completeEvent,
  sanitizeErrorMessage,
  tokenUpdateEvent,
} from "@agentprism/contracts";
import {
  applyContextPipeline,
  buildInitialMessages,
  buildSystemUser,
  createColumnSnippetRetriever,
  type AgentExecutionContext,
} from "@agentprism/harness";
import { buildMetrics } from "@agentprism/telemetry";
import {
  collectPriorToolNames,
  eventOf,
  executeToolCalls,
  formatCapabilityPluginIds,
  probeFrameworkRuntime,
  runtimeFromEnv,
  stepBudgetFor,
} from "@agentprism/driver-run-support";
import { runAutogenFrameworkBridge, bootstrapScriptPath } from "./autogen-bridge.js";
import {
  CODER_INSTRUCTION,
  isTerminationMessage,
  parseSpeakerSelection,
  REVIEWER_INSTRUCTION,
  speakerSelectionPrompt,
  type GroupChatSpeaker,
} from "./group-chat.js";

/** Reviewer speech budget by reasoning mode (mirrors the reflexion retry allowance). */
export function reviewerBudgetFor(reasoning: string): number {
  return reasoning === "reflexion" ? 3 : 2;
}

interface DriverStats {
  step: number;
  turns: number;
  toolCalls: number;
}

function isAssistantMessage(item: ArenaEvent | LlmAssistantMessage): item is LlmAssistantMessage {
  return "role" in item && item.role === "assistant";
}

function isToolMessage(
  item: ArenaEvent | { role: string },
): item is { role: "tool"; content: string; toolCallId: string; name?: string } {
  return "role" in item && item.role === "tool";
}

/**
 * Runs one speaker-selection call (group chat manager "auto" mode). The step
 * budget covers the call; the selection rides a reflect event so it can never
 * be mistaken for the answer.
 */
async function* selectSpeaker(
  context: AgentExecutionContext,
  messages: LlmMessage[],
  stats: DriverStats,
  retrieveSnippets: (query: string) => string,
  lastSpeaker: GroupChatSpeaker | null,
): AsyncGenerator<ArenaEvent, GroupChatSpeaker> {
  const { config, workspace } = context;
  const label = config.label;
  const workspaceName = workspace.name;
  stats.step += 1;
  stats.turns += 1;
  const selectionStep = stats.step;
  yield eventOf({ type: "step_start", pipeline: label, step: selectionStep, content: "", workspace: workspaceName });
  let text = "";
  try {
    const prepared = applyContextPipeline(
      [...messages, { role: "user", content: speakerSelectionPrompt(lastSpeaker) }],
      config.context,
      { retrieveSnippets, ...context.contextTuning },
    );
    const result = await context.llm.invoke(prepared, { signal: context.signal });
    text = result.text;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    text = "";
  }
  const speaker = parseSpeakerSelection(text);
  yield eventOf({
    type: "reflect",
    pipeline: label,
    step: selectionStep,
    content: `[AutoGen group chat] speaker: ${speaker}`,
    workspace: workspaceName,
  });
  return speaker;
}

/**
 * Streams one speaker turn; yields events plus the completed assistant message.
 * Coder turns emit thought deltas (their final reply is the answer); reviewer
 * turns stay silent on the thought channel so a critique can never win
 * answer extraction — the caller mirrors the text on a reflect event.
 */
async function* streamSpeakerTurn(
  context: AgentExecutionContext,
  messages: LlmMessage[],
  stats: DriverStats,
  retrieveSnippets: (query: string) => string,
  toolDefinitions: readonly ToolDefinition[],
  roleInstruction: string,
  bindTools: boolean,
  emitThought: boolean,
): AsyncGenerator<ArenaEvent | LlmAssistantMessage> {
  const { config, workspace } = context;
  const label = config.label;
  const workspaceName = workspace.name;
  const prepared = applyContextPipeline(
    [...messages, { role: "user", content: roleInstruction }],
    config.context,
    { retrieveSnippets, ...context.contextTuning },
  );
  const definitions = bindTools && toolDefinitions.length > 0 ? toolDefinitions : undefined;
  stats.step += 1;
  stats.turns += 1;
  const streamStep = stats.step;
  yield eventOf({ type: "step_start", pipeline: label, step: streamStep, content: "", workspace: workspaceName });
  let text = "";
  const toolCalls: NonNullable<LlmAssistantMessage["toolCalls"]> = [];
  for await (const part of context.llm.stream(prepared, {
    tools: definitions,
    signal: context.signal,
  })) {
    if (part.thinking !== undefined && part.thinking !== "") {
      yield eventOf({ type: "thinking", pipeline: label, step: streamStep, content: part.thinking, workspace: workspaceName });
    }
    if (part.text !== undefined && part.text !== "") {
      text += part.text;
      if (emitThought) {
        yield eventOf({ type: "thought_delta", pipeline: label, step: streamStep, content: part.text, workspace: workspaceName });
      }
    }
    if (part.toolCalls !== undefined && part.toolCalls.length > 0) toolCalls.push(...part.toolCalls);
  }
  if (emitThought) {
    yield eventOf({ type: "thought_end", pipeline: label, step: streamStep, content: "", workspace: workspaceName });
  }
  yield { role: "assistant", content: text, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
}

/** AutoGen-pattern driver: coder/reviewer group chat; the user proxy runs tools. */
export class AutogenDriver implements AgentDriver {
  readonly frameworkId = "autogen";
  readonly displayName = "AutoGen Group-Chat";

  /**
   * Runtime picker: the real AutoGen framework (Python bridge) when the
   * interpreter and the autogen_agentchat package are available, the
   * TypeScript pattern fallback otherwise. ARENA_AUTOGEN_RUNTIME forces a
   * side; `python` fails closed when the probe finds nothing.
   */
  async *run(context: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
    const runtime = runtimeFromEnv(process.env["ARENA_AUTOGEN_RUNTIME"]);
    const interpreter = runtime === "ts" ? null : probeFrameworkRuntime("autogen_agentchat");
    if (interpreter !== null) {
      yield* runAutogenFrameworkBridge({
        context,
        interpreter,
        bootstrapPath: bootstrapScriptPath(import.meta.url),
      });
      return;
    }
    if (runtime === "python") {
      throw new Error(
        "ARENA_AUTOGEN_RUNTIME=python requires a Python interpreter with the autogen-agentchat package " +
          "(pip install -r packages/drivers/driver-autogen/python/requirements.txt); " +
          "see packages/drivers/driver-autogen/README.md",
      );
    }
    yield* this.runPatternFallback(context);
  }

  /** TypeScript pattern fallback: neutral-transcript group chat loop. */
  private async *runPatternFallback(context: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
    const { config, question, history, tracker, workspace } = context;
    const label = config.label;
    const workspaceName = workspace.name;
    const started = context.clock.now();
    const stats: DriverStats = { step: 0, turns: 0, toolCalls: 0 };
    const retrieveSnippets = createColumnSnippetRetriever(context.rag, workspace);
    const toolDefinitions = context.tools.registry.listDefinitions();
    const { system, user } = buildSystemUser(context);
    tracker.seedPrompt(system, user);
    yield tokenUpdateEvent({ pipeline: label, token_stats: tracker.asDict(), workspace: workspaceName });
    yield eventOf({
      type: "thought",
      pipeline: label,
      step: 0,
      content:
        `${PIPELINE_BANNER_PREFIX.autogen} coder+reviewer · reasoning=${config.reasoning} · prompt=${config.prompt_profile} · ` +
        `context=${config.context} · harness=${config.harness} · ` +
        `temp=${config.temperature} · model=${config.model_id} · ` +
        `max_steps=${config.max_steps} · toolset=${config.toolset} · ` +
        `mcp=${String((config as Record<string, unknown>)["mcp_policy"] ?? "off")} · ` +
        `skill=${String((config as Record<string, unknown>)["skill_policy"] ?? "on_demand")} · ` +
        `orchestration=${String((config as Record<string, unknown>)["orchestration"] ?? "direct")} · ` +
        `history_mode=${String((config as Record<string, unknown>)["history_mode"] ?? "minimal")} · ` +
        formatCapabilityPluginIds(config),
      workspace: workspaceName,
    });

    const maxSteps = stepBudgetFor(config.max_steps);
    const messages: LlmMessage[] = buildInitialMessages(system, user, history);
    let reviewerRoundsLeft = reviewerBudgetFor(config.reasoning);
    let lastSpeaker: GroupChatSpeaker | null = null;
    let terminated = false;
    // False while the coder's last speech precedes a pending tool result —
    // only a coder turn without tool calls leaves a fresh final answer.
    let coderAnswerFresh = false;

    try {
      // Per-call budget granularity: the selection call and the speaker turn
      // each get their own slot check, so a round never overruns max_steps.
      while (!terminated) {
        if (stats.turns >= maxSteps) break;
        const speaker: GroupChatSpeaker = yield* selectSpeaker(context, messages, stats, retrieveSnippets, lastSpeaker);
        // Reviewer budget exhausted: the coder continues (bounded so a chatty
        // reviewer cannot consume the whole round budget).
        const effective: GroupChatSpeaker =
          speaker === "reviewer" && reviewerRoundsLeft <= 0 ? "coder" : speaker;
        lastSpeaker = effective;
        if (stats.turns >= maxSteps) break;

        if (effective === "reviewer") {
          reviewerRoundsLeft -= 1;
          let reviewerMessage: LlmAssistantMessage | null = null;
          for await (const item of streamSpeakerTurn(context, messages, stats, retrieveSnippets, toolDefinitions, REVIEWER_INSTRUCTION, false, false)) {
            if (isAssistantMessage(item)) reviewerMessage = item;
            else yield item;
          }
          if (reviewerMessage === null) break;
          messages.push(reviewerMessage);
          // Critique rides reflect: answer extraction keeps the coder's answer.
          yield eventOf({
            type: "reflect",
            pipeline: label,
            step: stats.step,
            content: `[AutoGen reviewer]\n${reviewerMessage.content.slice(0, 800)}`,
            workspace: workspaceName,
          });
          if (isTerminationMessage(reviewerMessage.content)) {
            terminated = true;
            // AutoGen's chat result is the last transcript message. When the
            // coder never spoke past a pending tool result, that verdict is
            // the only result the chat produced, so it must ride the thought
            // channel or answer extraction keeps a stale intent line.
            if (!coderAnswerFresh) {
              yield eventOf({
                type: "thought",
                pipeline: label,
                step: stats.step,
                content: reviewerMessage.content,
                workspace: workspaceName,
              });
            }
          }
        } else {
          let coderMessage: LlmAssistantMessage | null = null;
          for await (const item of streamSpeakerTurn(context, messages, stats, retrieveSnippets, toolDefinitions, CODER_INSTRUCTION, true, true)) {
            if (isAssistantMessage(item)) coderMessage = item;
            else yield item;
          }
          if (coderMessage === null) break;
          const priorToolNames = collectPriorToolNames(messages);
          messages.push(coderMessage);
          coderAnswerFresh = (coderMessage.toolCalls ?? []).length === 0;
          if ((coderMessage.toolCalls ?? []).length > 0) {
            for await (const item of executeToolCalls(context, coderMessage, question, priorToolNames, stats)) {
              if (isToolMessage(item)) messages.push(item);
              else yield item;
            }
          }
        }
      }

      yield completeEvent({
        pipeline: label,
        workspace: workspaceName,
        metrics: buildMetrics(tracker, {
          success: true,
          durationMs: context.clock.now() - started,
          toolCalls: stats.toolCalls,
          steps: stats.turns,
        }),
        token_stats: tracker.asDict(),
        turn: context.turn,
        runId: context.identity.runId,
        agentId: context.identity.agentId,
        timestamp: context.clock.now(),
      });
    } catch (error) {
      // Server-side detail log; the client-facing event stays sanitized.
      console.error(`[autogen-driver] column "${label}" failed:`, error);
      yield arenaErrorEvent({
        pipeline: label,
        workspace: workspaceName,
        message: sanitizeErrorMessage(error),
        turn: context.turn,
        timestamp: context.clock.now(),
        agentId: context.identity.agentId,
      });
      yield completeEvent({
        pipeline: label,
        workspace: workspaceName,
        metrics: buildMetrics(tracker, {
          success: false,
          durationMs: context.clock.now() - started,
          toolCalls: stats.toolCalls,
          steps: stats.turns,
        }),
        token_stats: tracker.asDict(),
        turn: context.turn,
        runId: context.identity.runId,
        agentId: context.identity.agentId,
        timestamp: context.clock.now(),
      });
    }
  }
}
