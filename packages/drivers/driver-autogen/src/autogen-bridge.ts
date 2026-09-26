/**
 * @file autogen-bridge
 * @description Python framework bridge for the AutoGen driver: wires the arena
 *              model and tool ports into the bootstrap process over NDJSON.
 *
 * Responsibilities:
 * - Build the startup handshake (question, tool catalog, budget)
 * - Answer llm_request lines through the harness LlmAdapter (usage lands in the tracker)
 * - Answer tool_request lines through the shared tool-batch executor (events preserved)
 * - Translate bridge events into ArenaEvents (coder speech rides the thought
 *   channel, reviewer speech the reflect channel — same contract as the
 *   TypeScript pattern fallback) and surface the final complete event
 *
 * The framework keeps the orchestration (group chat, speaker selection,
 * termination); the arena keeps the model, the tools, the budget, and the logs.
 *
 * Intentionally isomorphic with driver-crewai/src/crewai-bridge.ts: the event
 * pump, the tool handler, and the outcome tail are mirrored and structural
 * changes must land in both. The real divergences are the llm handler (tool
 * binding here vs the crewai step-budget note) and the event-channel mapping
 * (coder/reviewer thought+reflect here vs crewai reflect-only).
 */

import { fileURLToPath } from "node:url";
import type { ArenaEvent, LlmAssistantMessage, ToolDefinition } from "@agentprism/contracts";
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

/** Absolute path of the bundled bootstrap script (package root /python). */
export function bootstrapScriptPath(importMetaUrl: string): string {
  // dist/autogen-bridge.js -> ../../python/bootstrap.py (package root /python)
  return fileURLToPath(new URL("../../python/bootstrap.py", importMetaUrl));
}

export interface AutogenBridgeOptions {
  context: AgentExecutionContext;
  /** Probed interpreter command (python / python3 / ARENA_PYTHON override). */
  interpreter: string;
  /** Resolved bootstrap script path (see bootstrapScriptPath). */
  bootstrapPath: string;
}

/**
 * Runs the AutoGen group chat inside the Python bootstrap, translating the
 * NDJSON session into the driver's ArenaEvent stream. Yields the complete
 * event as the last value; failure paths mirror the pattern fallback's shape.
 */
export async function* runAutogenFrameworkBridge(options: AutogenBridgeOptions): AsyncGenerator<ArenaEvent> {
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
      const messages = request.messages.map(toLlmMessage);
      // Bind the arena definitions the bootstrap forwarded for this completion:
      // without them the model can never emit the toolCalls the bridge client
      // turns into autogen FunctionCalls. Tool-less turns (the reviewer agent
      // has no tools) arrive with an empty list and stay tool-free.
      const callTools = (request.tools ?? [])
        .map((tool) => toolDefinitions.find((definition) => definition.name === tool.name))
        .filter((definition) => definition !== undefined);
      const result = await context.llm.invoke(messages, {
        signal: context.signal,
        ...(callTools.length > 0 ? { tools: callTools } : {}),
      });
      // The header contract: bridge completions land in the token tracker like
      // every other model call (the bootstrap client reports zero usage).
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
      // empty prior-tool list (same visibility the pattern fallback has on its
      // first batch).
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
      // coder speech rides the thought channel (answer extraction), reviewer
      // speech the reflect channel — matching the pattern fallback exactly.
      if (message.speaker === "coder") {
        push(eventOf({ type: "thought", pipeline: label, step: stats.step, content: message.content, workspace: workspaceName }));
      } else {
        push(eventOf({ type: "reflect", pipeline: label, step: stats.step, content: `[AutoGen ${message.speaker}] ${message.content}`, workspace: workspaceName }));
      }
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
