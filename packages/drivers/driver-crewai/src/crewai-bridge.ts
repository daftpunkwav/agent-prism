/**
 * @file crewai-bridge
 * @description Python framework bridge for the CrewAI driver: wires the arena
 *              model and tool ports into the bootstrap process over NDJSON.
 *
 * Responsibilities:
 * - Build the startup handshake (question, history, tool catalog, budget, locale)
 * - Answer llm_request lines through the harness LlmAdapter (usage lands in the tracker)
 * - Answer tool_request lines through the shared tool-batch executor (events preserved)
 * - Translate bridge events into ArenaEvents (role speech rides the thought
 *   channel when it is the crew answer, the reflect channel otherwise) and
 *   surface the final complete event
 *
 * The framework keeps the orchestration (role crew, sequential/hierarchical
 * process, delegation); the arena keeps the model, the tools, the budget, and
 * the logs.
 */

import { fileURLToPath } from "node:url";
import type { ArenaEvent, LlmAssistantMessage, LlmMessage } from "@agentprism/contracts";
import { arenaErrorEvent, completeEvent, sanitizeErrorMessage } from "@agentprism/contracts";
import { buildMetrics } from "@agentprism/telemetry";
import type { AgentExecutionContext } from "@agentprism/harness";
import {
  eventOf,
  runChildBridge,
  executeToolCalls,
  stepBudgetFor,
  type ChildBridgeHandlers,
} from "@agentprism/driver-run-support";

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
      const messages: LlmMessage[] = request.messages.map(toLlmMessage);
      const result = await context.llm.invoke(messages, { signal: context.signal });
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
      history: historyOf(context),
      tools: toolDefinitions.map((definition) => ({
        name: definition.name,
        description: definition.description,
        parameters: (definition.jsonSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
      })),
      maxSteps,
      language: context.language ?? "",
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

/** Neutral history projection (role + text only; bridge history is prompt context). */
function historyOf(context: AgentExecutionContext): Array<{ role: string; content: string }> {
  return context.history.map((message) => ({
    role: message.role,
    content: typeof message.content === "string" ? message.content : "",
  }));
}

/** Converts one neutral bridge message into the harness LlmMessage shape. */
function toLlmMessage(message: {
  role: string;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; args: string }>;
}): LlmMessage {
  if (message.role === "assistant") {
    const toolCalls = (message.toolCalls ?? []).map((call) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.args) as Record<string, unknown>;
      } catch {
        args = {};
      }
      return { id: call.id, name: call.name, args };
    });
    return {
      role: "assistant",
      content: message.content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }
  if (message.role === "tool") {
    return { role: "tool", content: message.content, toolCallId: message.toolCallId ?? "", name: message.name ?? "" };
  }
  if (message.role === "system") {
    return { role: "system", content: message.content };
  }
  return { role: "user", content: message.content };
}
