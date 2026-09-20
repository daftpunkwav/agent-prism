/**
 * @file self-critique-driver
 * @description Self-Critique framework driver: executor loop with per-batch critic.
 *
 * Responsibilities:
 * - Run a ReAct executor loop over the harness context pipeline
 * - Score every tool batch with a tool-free critic call and redirect on low scores
 * - Translate turns/tools/critiques into the shared ArenaEvent stream
 *
 * Verification retries are owned by runVerificationLoop outside drivers.
 * Critic verdicts ride `reflect` events so answer extraction (which prefers
 * the last thought) never mistakes a critique for the final answer.
 * Distinct from harness-level reflect (whole-attempt retry) and from the
 * native reflexion reasoning mode (phase-gated rethink): the critic fires
 * after every batch with a numeric score and a bounded redirection budget.
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
import { emitToolOutcomeEvents, eventOf, formatCapabilityPluginIds, normalizeActionArgs, canonicalToolName, stepBudgetFor } from "@agentprism/driver-registry";

/** Critic verdict: numeric progress score plus a one-line next action. */
interface CriticVerdict {
  score: number;
  note: string;
  /** Whether the next action is the DONE token itself, so a run may end on the critic's word. */
  done: boolean;
}

/** Maximum critic-forced redirections per run (bounded so a harsh critic cannot loop forever). */
export const CRITIC_MAX_REDIRECTS = 2;

/**
 * Redirect budgets by reasoning mode (mirrors the native reflexion retry
 * allowance: reflexion tolerates one extra critic-forced retry).
 */
export function criticBudgetFor(reasoning: string): number {
  return reasoning === "reflexion" ? CRITIC_MAX_REDIRECTS + 1 : CRITIC_MAX_REDIRECTS;
}

/** Score below which the critic redirects the executor. */
export const CRITIC_REDIRECT_BELOW = 4;

/**
 * Whether the critic's next action is the DONE token itself.
 *
 * The protocol asks for `NEXT: <one concrete next action, or DONE>`, so only a
 * leading DONE ends a run. A substring test would also match prose that merely
 * mentions the word ("the script is half done") and stop a low-scoring attempt
 * that still had budget to redirect.
 */
function criticDeclaresDone(note: string): boolean {
  const nextAction = /\bNEXT:\s*(.*)$/i.exec(note)?.[1] ?? note;
  return /^DONE\b/i.test(nextAction.trim());
}

/** Parses `SCORE: <0-10>` plus a trailing note from the critic reply; null when malformed. */
export function parseCriticVerdict(text: string): CriticVerdict | null {
  const match = text.match(/SCORE:\s*(10|[0-9])/i);
  if (match === null) return null;
  const score = Number(match[1]);
  const note = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^SCORE:/i.test(line))
    .slice(0, 2)
    .join(" ");
  return { score, note: note === "" ? "(no note)" : note, done: criticDeclaresDone(note) };
}

async function criticPass(
  context: AgentExecutionContext,
  messages: LlmMessage[],
  retrieveSnippets: (query: string) => string,
): Promise<CriticVerdict | null> {
  const prepared = applyContextPipeline(
    [
      ...messages,
      {
        role: "user",
        content:
          "[Phase: Critic] Review the transcript above. Reply with exactly two lines:\n" +
          "SCORE: <0-10 progress toward the task>\n" +
          "NEXT: <one concrete next action, or DONE>",
      },
    ],
    context.config.context,
    { retrieveSnippets, ...context.contextTuning },
  );
  try {
    const result = await context.llm.invoke(prepared, { signal: context.signal });
    return parseCriticVerdict(result.text);
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    return null;
  }
}

/** Self-Critique driver: ReAct executor with a per-batch numeric critic. */
export class SelfCritiqueDriver implements AgentDriver {
  readonly frameworkId = "self_critique";
  readonly displayName = "Self-Critique";

  async *run(context: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
    const { config, question, history, tracker, workspace } = context;
    const label = config.label;
    const workspaceName = workspace.name;
    const started = context.clock.now();
    const stats = { step: 0, turns: 0, toolCalls: 0 };
    const retrieveSnippets = createColumnSnippetRetriever(context.rag, workspace);
    const definitions = context.tools.registry.listDefinitions();
    const { system, user } = buildSystemUser(context);
    tracker.seedPrompt(system, user);
    yield tokenUpdateEvent({ pipeline: label, token_stats: tracker.asDict(), workspace: workspaceName });
    yield eventOf({
      type: "thought",
      pipeline: label,
      step: 0,
      content:
        `${PIPELINE_BANNER_PREFIX.self_critique} react+critic · reasoning=${config.reasoning} · prompt=${config.prompt_profile} · ` +
        `context=${config.context} · harness=${config.harness} · toolset=${config.toolset} · ` +
        `mcp=${String((config as Record<string, unknown>)["mcp_policy"] ?? "off")} · ` +
        `skill=${String((config as Record<string, unknown>)["skill_policy"] ?? "on_demand")} · ` +
        `orchestration=${String((config as Record<string, unknown>)["orchestration"] ?? "direct")} · ` +
        formatCapabilityPluginIds(config),
      workspace: workspaceName,
    });

    const messages: LlmMessage[] = buildInitialMessages(system, user, history);
    const maxSteps = stepBudgetFor(config.max_steps);
    const maxRedirects = criticBudgetFor(config.reasoning);
    let redirects = 0;

    while (stats.turns < maxSteps) {
      const prepared = applyContextPipeline(messages, config.context, { retrieveSnippets, ...context.contextTuning });
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
      const response: LlmAssistantMessage = { role: "assistant", content: text, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
      messages.push(response);

      if ((response.toolCalls ?? []).length === 0) {
        // Tool-free turn: critic decides whether the run is done or drifting.
        const verdict = await criticPass(context, messages, retrieveSnippets);
        if (verdict === null || verdict.done || verdict.score >= CRITIC_REDIRECT_BELOW) {
          if (verdict !== null) {
            yield eventOf({ type: "reflect", pipeline: label, step: streamStep, content: `[Critic score ${verdict.score}] ${verdict.note}`, workspace: workspaceName });
          }
          break;
        }
        if (redirects >= maxRedirects) {
          yield eventOf({ type: "reflect", pipeline: label, step: streamStep, content: `[Critic score ${verdict.score}] redirect budget spent; stopping. ${verdict.note}`, workspace: workspaceName });
          break;
        }
        redirects += 1;
        messages.push({ role: "user", content: `[Critic redirect ${redirects}/${maxRedirects} — score ${verdict.score}] ${verdict.note}` });
        yield eventOf({ type: "reflect", pipeline: label, step: streamStep, content: `[Critic redirect ${redirects}/${maxRedirects} — score ${verdict.score}] ${verdict.note}`, workspace: workspaceName });
        continue;
      }

      // Tool batch with the shared drift guard.
      const prior: string[] = [];
      for (const message of messages.slice(0, -1)) {
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

      // Per-batch critic: score the batch, redirect only on low scores with budget left.
      const verdict = await criticPass(context, messages, retrieveSnippets);
      if (verdict === null) continue;
      yield eventOf({ type: "reflect", pipeline: label, step: stats.step, content: `[Critic score ${verdict.score}] ${verdict.note}`, workspace: workspaceName });
      if (verdict.score < CRITIC_REDIRECT_BELOW && redirects < maxRedirects && !verdict.done) {
        redirects += 1;
        const redirect = `[Critic redirect ${redirects}/${maxRedirects} — score ${verdict.score}] ${verdict.note}`;
        messages.push({ role: "user", content: redirect });
        yield eventOf({ type: "reflect", pipeline: label, step: stats.step, content: redirect, workspace: workspaceName });
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
  }
}
