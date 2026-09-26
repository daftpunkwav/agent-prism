/**
 * @file crewai-bridge
 * @description Python framework bridge for the CrewAI driver: wires the arena
 *              model and tool ports into the bootstrap process over NDJSON.
 *
 * Responsibilities:
 * - Build the startup handshake (question, tool catalog, budget)
 * - Answer llm_request lines through the harness LlmAdapter (usage lands in the tracker)
 *   and enforce the step budget against it (the crewai bootstrap has no
 *   internal budget, unlike the autogen MaxMessageTermination bound)
 * - Answer tool_request lines through the shared tool-batch executor (events preserved)
 * - Translate bridge events into ArenaEvents (role speech rides the reflect
 *   channel; the crew's final answer is the bridge's own final outcome, not a
 *   channel extraction) and surface the final complete event
 *
 * The framework keeps the orchestration (role crew, sequential/hierarchical
 * process, delegation); the arena keeps the model, the tools, the budget, and
 * the logs.
 *
 * Intentionally isomorphic with driver-autogen/src/autogen-bridge.ts: the event
 * pump, the tool handler, and the outcome tail are mirrored and structural
 * changes must land in both. The real divergences are the llm handler (the
 * host-side step-budget note here vs autogen tool binding) and the event-channel
 * mapping (reflect-only here vs autogen coder/reviewer thought+reflect).
 */

import { fileURLToPath } from "node:url";
import type { ArenaEvent, LlmAssistantMessage, LlmMessage } from "@agentprism/contracts";
import { arenaErrorEvent, completeEvent, sanitizeErrorMessage } from "@agentprism/contracts";
import { buildMetrics } from "@agentprism/telemetry";
import type { AgentExecutionContext } from "@agentprism/harness";
import { recordAdapterUsage } from "@agentprism/harness";
import {
  eventOf,
  runChildBridge,
  executeToolCalls,
  stepBudgetFor,
  toLlmMessage,
  type ChildBridgeHandlers,
} from "@agentprism/driver-run-support";

/** Completion served once the step budget is spent (see llmComplete). */
const BRIDGE_BUDGET_EXHAUSTED_NOTE =
  "[arena] Step budget exhausted: stop calling tools and reply with the best final answer for what is done.";

/** Absolute path of the bundled bootstrap script (package root /python). */
export function bootstrapScriptPath(importMetaUrl: string): string {
  // dist/crewai-bridge.js -> ../../python/bootstrap.py (package root /python)
  return fileURLToPath(new URL("../../python/bootstrap.py", importMetaUrl));
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
  const { config, question, tracker, workspace } = context;
  const label = config.label;
  const workspaceName = workspace.name;
  const started = context.clock.now();
  const stats = { step: 0, turns: 0, toolCalls: 0 };
  const maxSteps = stepBudgetFor(config.max_steps);

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
        // paying for completions and push the crew to wrap up.
        return BRIDGE_BUDGET_EXHAUSTED_NOTE;
      }
      const messages: LlmMessage[] = request.messages.map(toLlmMessage);
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
      // No neutral transcript rides the bridge, so the drift guard sees an
      // empty prior-tool list (first-batch visibility, same as autogen).
      let lastResult = "";
      for await (const item of executeToolCalls(context, response, question, [], stats)) {
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
      question,
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
      // Role speech rides the reflect channel (the crew's final answer is the
      // framework's own crew output, not a channel extraction).
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
