/**
 * @file plan-execute-driver
 * @description Plan-Execute framework driver: planner pass then executor loop.
 *
 * Responsibilities:
 * - Run one tool-free planner call producing numbered steps
 * - Execute a ReAct executor loop pinned to the plan with bounded replans
 * - Translate turns/tools into the shared ArenaEvent stream
 *
 * Verification retries are owned by runVerificationLoop outside drivers.
 * Planner deliberation rides `reflect` events so answer extraction (which
 * prefers the last thought) never mistakes the plan for the final answer.
 */

import type {
  AgentDriver,
  ArenaEvent,
  LlmAssistantMessage,
  LlmMessage,
  LlmToolMessage,
} from "@agentprism/contracts";
import {
  OBSERVATION_MAX_CHARS,
  PIPELINE_BANNER_PREFIX,
  completeEvent,
  sanitizeErrorMessage,
  tokenUpdateEvent,
} from "@agentprism/contracts";
import {
  applyContextPipeline,
  blockedToolMessageContent,
  buildInitialMessages,
  buildSystemUser,
  createColumnSnippetRetriever,
  type AgentExecutionContext,
} from "@agentprism/harness";
import { buildMetrics } from "@agentprism/telemetry";
import { emitToolOutcomeEvents, eventOf, formatCapabilityPluginIds, normalizeActionArgs, canonicalToolName, parseScoreVerdict, stepBudgetFor, totWidth } from "@agentprism/driver-registry";

/** Executor state: consecutive tool-free turns plus remaining replan budgets. */
interface ExecutorState {
  quietTurns: number;
  replansLeft: number;
}

/** Replan budgets by reasoning mode (mirrors the native reflexion retry allowance). */
export function replanBudgetFor(reasoning: string): number {
  return reasoning === "reflexion" ? 2 : 1;
}

async function invokePlanner(context: AgentExecutionContext, system: string, user: string): Promise<string> {
  const prepared = applyContextPipeline(
    [
      { role: "system", content: `${system}\n\n[Phase: Plan] Reason only; do not call tools.` },
      { role: "user", content: user },
    ],
    context.config.context,
    { analytics: context.contextAnalytics, ...context.contextTuning },
  );
  const result = await context.llm.invoke(prepared, { signal: context.signal });
  return result.text.trim();
}

/**
 * Planner pass, shaped by the reasoning mode: react plans directly, cot_tool
 * reasons through the approach first, tot branches for real (totWidth
 * independent candidate calls, each scored by its own call, argmax winner),
 * reflexion plans directly (its budget shows up as extra replans instead).
 */
async function plannerPass(context: AgentExecutionContext, system: string, user: string): Promise<string> {
  const reasoning = context.config.reasoning;
  if (reasoning === "tot") {
    const width = totWidth();
    const candidates: string[] = [];
    for (let index = 0; index < width; index += 1) {
      const candidate = await invokePlanner(
        context,
        system,
        `${user}\n\n[Plan branch ${index + 1}/${width}] Propose ONE distinct solution approach (at most 4 steps) for the task above. No tool calls.`,
      );
      if (candidate !== "") candidates.push(candidate);
    }
    if (candidates.length === 0) return "";
    const scores: number[] = [];
    for (const candidate of candidates) {
      const verdict = await invokePlanner(
        context,
        system,
        `Score this plan 0-10 for likelihood of completing the task. Reply with "SCORE: <0-10>" first.\n\nTask:\n${user}\n\nPlan:\n${candidate}`,
      );
      scores.push(parseScoreVerdict(verdict) ?? 0);
    }
    let best = 0;
    for (let index = 1; index < scores.length; index += 1) {
      if ((scores[index] ?? 0) > (scores[best] ?? 0)) best = index;
    }
    return candidates[best] ?? "";
  }
  if (reasoning === "cot_tool") {
    return invokePlanner(
      context,
      system,
      `${user}\n\nFirst analyze the problem and lay out your reasoning chain, then produce a short numbered plan (at most 6 steps). No tool calls.`,
    );
  }
  return invokePlanner(
    context,
    system,
    `${user}\n\nProduce a short numbered plan (at most 6 steps) for the task above. No tool calls.`,
  );
}

/** Streams one executor turn; yields events plus the completed assistant message. */
async function* streamExecutorTurn(
  context: AgentExecutionContext,
  messages: LlmMessage[],
  stats: { step: number; turns: number; toolCalls: number },
  retrieveSnippets: (query: string) => string,
): AsyncGenerator<ArenaEvent | LlmAssistantMessage> {
  const { config, workspace } = context;
  const label = config.label;
  const workspaceName = workspace.name;
  const prepared = applyContextPipeline(messages, config.context, { retrieveSnippets, ...context.contextTuning });
  const definitions = context.tools.registry.listDefinitions();
  stats.step += 1;
  stats.turns += 1;
  const streamStep = stats.step;
  yield eventOf({ type: "step_start", pipeline: label, step: streamStep, content: "", workspace: workspaceName });
  let text = "";
  const toolCalls: NonNullable<LlmAssistantMessage["toolCalls"]> = [];
  for await (const part of context.llm.stream(prepared, {
    tools: definitions.length > 0 ? definitions : undefined,
    signal: context.signal,
  })) {
    if (part.thinking !== undefined && part.thinking !== "") {
      yield eventOf({ type: "thinking", pipeline: label, step: streamStep, content: part.thinking, workspace: workspaceName });
    }
    if (part.text !== undefined && part.text !== "") {
      text += part.text;
      yield eventOf({ type: "thought_delta", pipeline: label, step: streamStep, content: part.text, workspace: workspaceName });
    }
    if (part.toolCalls !== undefined && part.toolCalls.length > 0) toolCalls.push(...part.toolCalls);
  }
  yield eventOf({ type: "thought_end", pipeline: label, step: streamStep, content: "", workspace: workspaceName });
  yield { role: "assistant", content: text, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
}

/** Executes one assistant tool batch with drift guard and outcome events. */
async function* executeBatch(
  context: AgentExecutionContext,
  question: string,
  response: LlmAssistantMessage,
  messages: LlmMessage[],
  stats: { step: number; turns: number; toolCalls: number },
): AsyncGenerator<ArenaEvent> {
  const { config, workspace } = context;
  const label = config.label;
  const workspaceName = workspace.name;
  const prior: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant" || message.toolCalls === undefined) continue;
    for (const call of message.toolCalls) prior.push(call.name);
  }
  for (const rawCall of response.toolCalls ?? []) {
    const call = { ...rawCall, name: canonicalToolName(context.tools.names, rawCall.name) };
    if (!context.tools.names.has(call.name)) {
      messages.push({ role: "tool", content: `Error: tool ${call.name} is not authorized`, toolCallId: call.id, name: call.name });
      continue;
    }
    const blocked = blockedToolMessageContent(question, call.name, call.args, prior, context.config.harness);
    if (blocked !== null) {
      messages.push({ role: "tool", content: blocked, toolCallId: call.id, name: call.name });
      continue;
    }
    stats.toolCalls += 1;
    stats.step += 1;
    yield eventOf({ type: "action", pipeline: label, step: stats.step, tool: call.name, args: normalizeActionArgs(call.name, call.args), workspace: workspaceName });
    let result: string;
    let fileDiff: string | null = null;
    try {
      const outcome = await context.tools.execute(call.name, call.args, { signal: context.signal });
      result = outcome.result;
      fileDiff = outcome.fileDiff;
    } catch (error) {
      if ((error as Error)?.name === "AbortError") throw error;
      result = `Error: tool ${call.name} failed: ${sanitizeErrorMessage(error)}`;
    }
    for (const event of emitToolOutcomeEvents(label, workspaceName, stats.step, call.name, { result, fileDiff })) {
      yield event;
    }
    stats.step += 1;
    yield eventOf({ type: "observation", pipeline: label, step: stats.step, result: result.slice(0, OBSERVATION_MAX_CHARS), workspace: workspaceName });
    const toolMessage: LlmToolMessage = { role: "tool", content: result, toolCallId: call.id, name: call.name };
    messages.push(toolMessage);
  }
}

function isAssistantMessage(item: ArenaEvent | LlmAssistantMessage): item is LlmAssistantMessage {
  return "role" in item && item.role === "assistant";
}

/** Plan-Execute driver: planner pass then a plan-pinned executor ReAct loop. */
export class PlanExecuteDriver implements AgentDriver {
  readonly frameworkId = "plan_execute";
  readonly displayName = "Plan-Execute";

  async *run(context: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
    const { config, question, history, tracker, workspace } = context;
    const label = config.label;
    const workspaceName = workspace.name;
    const started = context.clock.now();
    const stats = { step: 0, turns: 0, toolCalls: 0 };
    const retrieveSnippets = createColumnSnippetRetriever(context.rag, workspace);
    const { system, user } = buildSystemUser(context);
    tracker.seedPrompt(system, user);
    yield tokenUpdateEvent({ pipeline: label, token_stats: tracker.asDict(), workspace: workspaceName });
    yield eventOf({
      type: "thought",
      pipeline: label,
      step: 0,
      content:
        `${PIPELINE_BANNER_PREFIX.plan_execute} planner+executor · reasoning=${config.reasoning} · prompt=${config.prompt_profile} · ` +
        `context=${config.context} · harness=${config.harness} · toolset=${config.toolset} · ` +
        `mcp=${String((config as Record<string, unknown>)["mcp_policy"] ?? "off")} · ` +
        `skill=${String((config as Record<string, unknown>)["skill_policy"] ?? "on_demand")} · ` +
        `orchestration=${String((config as Record<string, unknown>)["orchestration"] ?? "direct")} · ` +
        formatCapabilityPluginIds(config),
      workspace: workspaceName,
    });

    let plan = "";
    try {
      plan = await plannerPass(context, system, user);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") throw error;
      plan = "";
    }
    const state: ExecutorState = { quietTurns: 0, replansLeft: replanBudgetFor(config.reasoning) };
    const messages: LlmMessage[] = buildInitialMessages(
      system,
      plan === "" ? user : `${user}\n\n[Agreed plan]\n${plan}\nFollow these steps; report deviations explicitly.`,
      history,
    );
    if (plan !== "") {
      yield eventOf({ type: "reflect", pipeline: label, step: 0, content: `[Plan-Execute plan]\n${plan}`, workspace: workspaceName });
    }

    const maxSteps = stepBudgetFor(config.max_steps);
    while (stats.turns < maxSteps) {
      let response: LlmAssistantMessage | null = null;
      for await (const item of streamExecutorTurn(context, messages, stats, retrieveSnippets)) {
        if (isAssistantMessage(item)) response = item;
        else yield item;
      }
      if (response === null) break;
      messages.push(response);
      const hadTools = (response.toolCalls ?? []).length > 0;
      if (!hadTools) {
        state.quietTurns += 1;
        if (state.quietTurns >= 2 && state.replansLeft > 0) {
          state.replansLeft -= 1;
          let revised = "";
          try {
            revised = await context.llm.invoke(
              applyContextPipeline(
                [...messages, { role: "user", content: "[Phase: Replan] Progress stalled without tool use. Revise the remaining steps briefly." }],
                config.context,
                { retrieveSnippets, ...context.contextTuning },
              ),
              { signal: context.signal },
            ).then((r) => r.text.trim());
          } catch (error) {
            if ((error as Error)?.name === "AbortError") throw error;
            revised = "";
          }
          if (revised !== "") {
            plan = revised;
            messages.push({ role: "user", content: `[Revised plan]\n${revised}` });
            yield eventOf({ type: "reflect", pipeline: label, step: stats.step, content: `[Plan-Execute replan]\n${revised}`, workspace: workspaceName });
          }
          state.quietTurns = 0;
          continue;
        }
        if (state.quietTurns >= 3) break;
        continue;
      }
      state.quietTurns = 0;
      yield* executeBatch(context, question, response, messages, stats);
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
  }
}
