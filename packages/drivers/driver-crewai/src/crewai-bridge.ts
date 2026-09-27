/**
 * @file crewai-bridge
 * @description Python framework bridge for the CrewAI driver: wires the arena
 *              model and tool ports into the bootstrap process over NDJSON.
 *
 * Responsibilities:
 * - Build the startup handshake (task prompt, tool catalog, budget)
 * - Answer llm_request lines through the harness LlmAdapter (usage lands in the tracker)
 *   and enforce the step budget against it (the crewai bootstrap has no
 *   internal budget, unlike the autogen MaxMessageTermination bound)
 * - Answer tool_request lines through the shared tool-batch executor (events preserved)
 * - Translate bridge events into ArenaEvents (role speech rides the reflect
 *   channel, the crew's own final output closes the thought channel as the
 *   answer) and surface the final complete event
 *
 * The framework keeps the orchestration (role crew, sequential/hierarchical
 * process, delegation); the arena keeps the model, the tools, the budget, and
 * the logs. Every completion the child asks for is prepared like an in-process
 * column's model call: the Arena system prompt rides the child's leading system
 * turn, the context pipeline (trim/retrieve) applies, and this turn's prior
 * history is spliced in on the first request — the crew's own role copy stays
 * behind the Arena prompt.
 *
 * Intentionally isomorphic with driver-autogen/src/autogen-bridge.ts: the event
 * pump, the tool handler, and the outcome tail are mirrored and structural
 * changes must land in both. The real divergences are the llm handler (the
 * host-side step-budget note here vs autogen tool binding) and the event-channel
 * mapping (reflect-only here vs autogen coder/reviewer thought+reflect).
 */

import type { ArenaEvent, LlmAssistantMessage, LlmMessage } from "@agentprism/contracts";
import { arenaErrorEvent, completeEvent, sanitizeErrorMessage, tokenUpdateEvent } from "@agentprism/contracts";
import { buildMetrics } from "@agentprism/telemetry";
import type { AgentExecutionContext } from "@agentprism/harness";
import { applyContextPipeline, buildSystemUser, createColumnSnippetRetriever, recordAdapterUsage } from "@agentprism/harness";
import {
  BRIDGE_BUDGET_EXHAUSTED_NOTE,
  eventOf,
  runChildBridge,
  executeToolCalls,
  stepBudgetFor,
  priorToolNamesFromWire,
  resolveBridgeScript,
  toLlmMessage,
  withArenaSystem,
  withHistory,
  type ChildBridgeHandlers,
} from "@agentprism/driver-run-support";

/** Absolute path of the bundled bootstrap script (package root /python). */
export function bootstrapScriptPath(importMetaUrl: string): string {
  return resolveBridgeScript(importMetaUrl);
}

export interface CrewaiBridgeOptions {
  context: AgentExecutionContext;
  /** Probed interpreter command (python / python3 / ARENA_PYTHON override). */
  interpreter: string;
  /** Resolved bootstrap script path (see bootstrapScriptPath). */
  bootstrapPath: string;
}

/**
 * Runs the CrewAI crew inside the Python bootstrap, translating the NDJSON
 * session into the driver's ArenaEvent stream. Yields the complete event as
 * the last value; failure paths mirror the pattern fallback's shape.
 */
export async function* runCrewaiFrameworkBridge(options: CrewaiBridgeOptions): AsyncGenerator<ArenaEvent> {
  const { context, interpreter, bootstrapPath } = options;
  const { config, tracker, workspace } = context;
  const label = config.label;
  const workspaceName = workspace.name;
  const started = context.clock.now();
  const stats = { step: 0, turns: 0, toolCalls: 0 };
  const maxSteps = stepBudgetFor(config.max_steps);

  // Same prompt assembly every in-process column runs on (system + rendered
  // history + this turn's user part). The user part becomes the crew's task;
  // the system part is merged into the crew's role copy per completion.
  const { system, user } = buildSystemUser(context);
  const retrieveSnippets = createColumnSnippetRetriever(context.rag, workspace);
  tracker.seedPrompt(system, user);
  yield tokenUpdateEvent({ pipeline: label, token_stats: tracker.asDict(), workspace: workspaceName });

  // Event pump: bridge handlers and translated child events interleave in one
  // queue; the generator body drains it in arrival order until the run settles.
  const queue: ArenaEvent[] = [];
  let notify: (() => void) | null = null;
  let settled = false;
  const push = (event: ArenaEvent): void => {
    queue.push(event);
    notify?.();
    notify = null;
  };

  // History belongs to the conversation's first completion: the crew's own
  // transcript carries every later turn (see withHistory).
  let firstCompletion = true;
  // Tool names the last transcript already carried. At tool_request time the
  // current batch is not in it yet, so this is exactly the "prior calls" list the
  // drift guard compares against on every other backend.
  let priorToolNames: string[] = [];

  const toolDefinitions = context.tools.registry
    .listDefinitions()
    .filter((definition) => context.tools.names.has(definition.name));

  const handlers: ChildBridgeHandlers = {
    llmComplete: async (request) => {
      stats.turns += 1;
      stats.step += 1;
      if (stats.turns > maxSteps) {
        // The crewai bootstrap has no internal budget knob: a crew looping on
        // a task would keep consuming the arena model. Past the budget, stop
        // paying for completions and push the crew to wrap up. Verified against
        // crewai 1.15: the host really stops paying (no further model calls),
        // and crewai may end the crew through its own agent-retry path (it
        // parses a completion that does not fit its output protocol); this
        // column's contract is the bound, not the framework's failure text.
        return BRIDGE_BUDGET_EXHAUSTED_NOTE;
      }
      priorToolNames = priorToolNamesFromWire(request.messages);
      let messages: LlmMessage[] = request.messages.map(toLlmMessage);
      if (firstCompletion) {
        messages = withHistory(messages, context.history);
        firstCompletion = false;
      }
      messages = applyContextPipeline(withArenaSystem(messages, system), config.context, {
        retrieveSnippets,
        analytics: context.contextAnalytics,
        ...context.contextTuning,
      });
      const result = await context.llm.invoke(messages, { signal: context.signal });
      // The header contract: bridge completions land in the token tracker like
      // every other model call (the bootstrap LLM reports zero usage).
      recordAdapterUsage(result.usage, tracker);
      return JSON.stringify({
        content: result.text,
        toolCalls: (result.toolCalls ?? []).map((call) => ({
          id: call.id,
          name: call.name,
          args: typeof call.args === "string" ? call.args : JSON.stringify(call.args),
        })),
      });
    },
    toolExecute: async (request) => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(request.args) as Record<string, unknown>;
      } catch {
        parsed = {};
      }
      const response: LlmAssistantMessage = {
        role: "assistant",
        content: "",
        toolCalls: [{ id: request.id, name: request.name, args: parsed }],
      };
      // Drift guard inputs: the prior calls of the transcript that produced this
      // batch (see priorToolNames). Same set the in-process loops pass.
      let lastResult = "";
      for await (const item of executeToolCalls(context, response, context.question, priorToolNames, stats)) {
        if ("role" in item) {
          lastResult = item.content;
          continue;
        }
        push(item);
      }
      return lastResult;
    },
  };

  const done = runChildBridge({
    command: interpreter,
    args: [bootstrapPath],
    cwd: context.workspace.cwd(),
    signal: context.signal,
    start: {
      type: "start",
      // The assembled Arena user part (question + mentions + retrieval + profile
      // suffix), not the bare question: the crew's task text must carry the same
      // text every in-process column sends as its user message.
      question: user,
      tools: toolDefinitions.map((definition) => ({
        name: definition.name,
        description: definition.description,
        parameters: (definition.jsonSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
      })),
      maxSteps,
    },
    handlers,
    onEvent: (message) => {
      if (message.type !== "event") return;
      // Role speech rides the reflect channel; the crew's own final output is
      // emitted as the closing thought once the session settles (see the tail).
      push(eventOf({ type: "reflect", pipeline: label, step: stats.step, content: `[CrewAI ${message.speaker}] ${message.content}`, workspace: workspaceName }));
    },
  }).then(
    (outcome) => {
      settled = true;
      notify?.();
      return outcome;
    },
    (error: unknown) => {
      settled = true;
      notify?.();
      return {
        ok: false as const,
        message: sanitizeErrorMessage(error),
      };
    },
  );

  let index = 0;
  while (true) {
    if (index < queue.length) {
      yield queue[index] as ArenaEvent;
      index += 1;
      continue;
    }
    if (settled) break;
    await new Promise<void>((resolve) => {
      notify = resolve;
    });
  }
  const outcome = await done;

  if (!outcome.ok) {
    yield arenaErrorEvent({
      pipeline: label,
      workspace: workspaceName,
      message: sanitizeErrorMessage(outcome.message),
      turn: context.turn,
      runId: context.identity.runId,
      agentId: context.identity.agentId,
    });
  } else if (outcome.answer.trim() !== "") {
    // The crew's own output must reach the answer channel: role speech rides the
    // reflect channel (critiques must never win answer extraction), and extraction
    // reads the thought channel — without this the column would complete with an
    // empty answer. Same contract as the pattern fallback, whose closing worker
    // turn is the answer.
    yield eventOf({
      type: "thought",
      pipeline: label,
      step: stats.step,
      content: outcome.answer,
      workspace: workspaceName,
    });
  }
  yield completeEvent({
    pipeline: label,
    workspace: workspaceName,
    metrics: buildMetrics(tracker, {
      success: outcome.ok,
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
