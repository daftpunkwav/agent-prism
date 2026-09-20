/**
 * @file crewai-driver
 * @description CrewAI-pattern framework driver: role crew running a task pipeline.
 *
 * Responsibilities:
 * - Run the sequential task pipeline (research → implement → verify) with role
 *   workers, or the hierarchical process under ARENA_CREWAI_PROCESS=hierarchical
 * - Keep task boundaries and manager delegations on reflect events; worker
 *   thoughts carry the answer (the pipeline ends on the reviewer's turn)
 * - Translate crew work into the shared ArenaEvent stream
 *
 * Faithful-pattern implementation of CrewAI's crew/task/process model on the
 * arena's shared ports (same tools, workspace, telemetry); not vendor code.
 * max_steps budgets every crew LLM call. Verification retries are owned by
 * runVerificationLoop outside drivers. Reflexion grants one extra turn per task.
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
  stepBudgetFor,
} from "@agentprism/driver-registry";
import {
  MANAGER_INSTRUCTION,
  SEQUENTIAL_TASKS,
  crewProcess,
  parseManagerAssignment,
  roleByKey,
  roleInstruction,
  type CrewProcess,
  type CrewRole,
} from "./crew.js";

/** Worker turns allowed per sequential task (bounded so one task cannot eat the budget). */
export function taskTurnCapFor(reasoning: string): number {
  return reasoning === "reflexion" ? 4 : 3;
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

/** Streams one worker turn; yields events plus the completed assistant message. */
async function* streamWorkerTurn(
  context: AgentExecutionContext,
  messages: LlmMessage[],
  stats: DriverStats,
  retrieveSnippets: (query: string) => string,
  toolDefinitions: readonly ToolDefinition[],
  instruction: string,
): AsyncGenerator<ArenaEvent | LlmAssistantMessage> {
  const { config, workspace } = context;
  const label = config.label;
  const workspaceName = workspace.name;
  const prepared = applyContextPipeline(
    [...messages, { role: "user", content: instruction }],
    config.context,
    { retrieveSnippets, ...context.contextTuning },
  );
  const definitions = toolDefinitions.length > 0 ? toolDefinitions : undefined;
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
      yield eventOf({ type: "thought_delta", pipeline: label, step: streamStep, content: part.text, workspace: workspaceName });
    }
    if (part.toolCalls !== undefined && part.toolCalls.length > 0) toolCalls.push(...part.toolCalls);
  }
  yield eventOf({ type: "thought_end", pipeline: label, step: streamStep, content: "", workspace: workspaceName });
  yield { role: "assistant", content: text, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
}

interface WorkerOutcome {
  text: string;
  /** False when the worker finished the pass without calling tools. */
  usedTools: boolean;
}

/**
 * Runs one worker turn (plus a result-consuming pass when tools were used);
 * yields events, returns the worker's report and appends to the transcript.
 * Both turns respect the per-call step budget.
 */
async function* runWorker(
  context: AgentExecutionContext,
  messages: LlmMessage[],
  stats: DriverStats,
  retrieveSnippets: (query: string) => string,
  toolDefinitions: readonly ToolDefinition[],
  question: string,
  maxSteps: number,
  instruction: string,
): AsyncGenerator<ArenaEvent, WorkerOutcome> {
  let response: LlmAssistantMessage | null = null;
  for await (const item of streamWorkerTurn(context, messages, stats, retrieveSnippets, toolDefinitions, instruction)) {
    if (isAssistantMessage(item)) response = item;
    else yield item;
  }
  if (response === null) return { text: "", usedTools: false };
  const priorToolNames = collectPriorToolNames(messages);
  messages.push(response);
  if ((response.toolCalls ?? []).length === 0) {
    return { text: response.content, usedTools: false };
  }
  for await (const item of executeToolCalls(context, response, question, priorToolNames, stats)) {
    if (isToolMessage(item)) messages.push(item);
    else yield item;
  }
  // Tool rounds continue with one result-consuming pass — but only within budget.
  if (stats.turns >= maxSteps) {
    return { text: response.content, usedTools: true };
  }
  let followUp: LlmAssistantMessage | null = null;
  for await (const item of streamWorkerTurn(context, messages, stats, retrieveSnippets, toolDefinitions, "[CrewAI] Continue from the tool results above.")) {
    if (isAssistantMessage(item)) followUp = item;
    else yield item;
  }
  if (followUp === null) return { text: response.content, usedTools: true };
  messages.push(followUp);
  // A follow-up that wants more tools must have them executed here: pushing an
  // assistant message with tool calls but no tool results makes the transcript
  // invalid and the next LLM call fails with a provider 400.
  if ((followUp.toolCalls ?? []).length > 0) {
    for await (const item of executeToolCalls(context, followUp, question, priorToolNames, stats)) {
      if (isToolMessage(item)) messages.push(item);
      else yield item;
    }
  }
  return { text: followUp.content, usedTools: true };
}

/** Runs one manager delegation call (hierarchical process); yields events, returns the raw reply. */
async function* runManagerCall(
  context: AgentExecutionContext,
  messages: LlmMessage[],
  stats: DriverStats,
  retrieveSnippets: (query: string) => string,
): AsyncGenerator<ArenaEvent, string> {
  const { config, workspace } = context;
  stats.step += 1;
  stats.turns += 1;
  const step = stats.step;
  yield eventOf({ type: "step_start", pipeline: config.label, step, content: "", workspace: workspace.name });
  let text = "";
  try {
    const prepared = applyContextPipeline(
      [...messages, { role: "user", content: MANAGER_INSTRUCTION }],
      config.context,
      { retrieveSnippets, ...context.contextTuning },
    );
    const result = await context.llm.invoke(prepared, { signal: context.signal });
    text = result.text;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    text = "";
  }
  yield eventOf({
    type: "reflect",
    pipeline: config.label,
    step,
    content: `[CrewAI manager] ${text.trim() === "" ? "(no reply — falling back to the reviewer)" : text.trim().slice(0, 300)}`,
    workspace: workspace.name,
  });
  return text;
}

/** CrewAI-pattern driver: a role crew running a task pipeline. */
export class CrewAIDriver implements AgentDriver {
  readonly frameworkId = "crewai";
  readonly displayName = "CrewAI Crew";

  async *run(context: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
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
    const process: CrewProcess = crewProcess();
    yield eventOf({
      type: "thought",
      pipeline: label,
      step: 0,
      content:
        `${PIPELINE_BANNER_PREFIX.crewai} ${process} process · reasoning=${config.reasoning} · prompt=${config.prompt_profile} · ` +
        `context=${config.context} · harness=${config.harness} · toolset=${config.toolset} · ` +
        `mcp=${String((config as Record<string, unknown>)["mcp_policy"] ?? "off")} · ` +
        `skill=${String((config as Record<string, unknown>)["skill_policy"] ?? "on_demand")} · ` +
        `orchestration=${String((config as Record<string, unknown>)["orchestration"] ?? "direct")} · ` +
        formatCapabilityPluginIds(config),
      workspace: workspaceName,
    });

    const maxSteps = stepBudgetFor(config.max_steps);
    const messages: LlmMessage[] = buildInitialMessages(system, user, history);
    const taskTurnCap = taskTurnCapFor(config.reasoning);

    try {
      if (process === "sequential") {
        for (let index = 0; index < SEQUENTIAL_TASKS.length && stats.turns < maxSteps; index += 1) {
          const task = SEQUENTIAL_TASKS[index] as (typeof SEQUENTIAL_TASKS)[number];
          const role = roleByKey(task.role);
          yield eventOf({
            type: "reflect",
            pipeline: label,
            step: stats.step,
            content: `[CrewAI crew] task ${index + 1}/${SEQUENTIAL_TASKS.length} → ${role.role}: ${task.task}`,
            workspace: workspaceName,
          });
          let output = "";
          for (let turn = 0; turn < taskTurnCap && stats.turns < maxSteps; turn += 1) {
            const { text, usedTools } = yield* runWorker(context, messages, stats, retrieveSnippets, toolDefinitions, question, maxSteps, roleInstruction(role, task.task, task.expectedOutput));
            output = text;
            // A tool-free worker pass completes the task's expected output.
            if (!usedTools) break;
          }
          if (output !== "") {
            messages.push({ role: "user", content: `[CrewAI] ${role.role} task output:\n${output}` });
            yield eventOf({
              type: "reflect",
              pipeline: label,
              step: stats.step,
              content: `[CrewAI crew] ${role.role} output ready (${output.length} chars).`,
              workspace: workspaceName,
            });
          }
        }
      } else {
        // Hierarchical: the manager delegates one member per round; CREW_COMPLETE
        // or the step budget ends the crew, then the reviewer wraps up.
        let lastRole: CrewRole["key"] = "researcher";
        while (stats.turns < maxSteps) {
          const managerReply = yield* runManagerCall(context, messages, stats, retrieveSnippets);
          const assignment = parseManagerAssignment(managerReply);
          if (assignment === null) {
            // Unparsable manager reply: leave the wrap-up to the post-loop
            // reviewer pass instead of trusting a garbled delegation.
            break;
          }
          const role = roleByKey(assignment.role);
          lastRole = role.key;
          if (assignment.complete) {
            // The manager declared completion; the reviewer still verifies the
            // work and produces the final answer (the pipeline's closing pass).
            const reviewer = roleByKey("reviewer");
            if (stats.turns < maxSteps) {
              yield* runWorker(context, messages, stats, retrieveSnippets, toolDefinitions, question, maxSteps, roleInstruction(reviewer, "The manager declared the crew done. Verify the work and produce the final answer.", "What was done, artifact paths, how to run them."));
            }
            break;
          }
          if (stats.turns < maxSteps) {
            const { text } = yield* runWorker(context, messages, stats, retrieveSnippets, toolDefinitions, question, maxSteps, roleInstruction(role, assignment.task, "Progress toward the crew goal."));
            if (text !== "") {
              messages.push({ role: "user", content: `[CrewAI] ${role.role} reports:\n${text}` });
            }
          }
        }
        if (lastRole !== "reviewer" && stats.turns < maxSteps) {
          const reviewer = roleByKey("reviewer");
          yield* runWorker(context, messages, stats, retrieveSnippets, toolDefinitions, question, maxSteps, roleInstruction(reviewer, "Produce the crew's final answer.", "What was done, artifact paths, how to run them."));
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
      console.error(`[crewai-driver] column "${label}" failed:`, error);
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
