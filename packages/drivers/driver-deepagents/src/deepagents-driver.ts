/**
 * @file deepagents-driver
 * @description Deep Agents (LangChain) driver: planning tool, virtual filesystem
 *              and subagents over the LangGraph runtime.
 *
 * Responsibilities:
 * - Run the real createDeepAgent middleware stack over the Arena model port
 * - Drop registry tools whose names the framework reserves, and scope its own
   filesystem tools to read-only access of the Arena workspace
 * - Keep the shared context pipeline and tool drift guard on every model call
 * - Translate the framework's LangGraph event stream into ArenaEvents
 *
 * Uses the arena's ChatModel (llmVendor) and the registry tools, so the column
 * shares the model, tool surface and telemetry with every other backend. The
 * deep agent's own filesystem tools keep the framework default: they operate on
 * its in-memory StateBackend, never on the workspace, so real workspace
 * mutations stay on the guarded tool path.
 */

import type { ArenaEvent, AgentDriver } from "@agentprism/contracts";
import {
  PIPELINE_BANNER_PREFIX,
  arenaErrorEvent,
  sanitizeErrorMessage,
  textFromContent,
  tokenUpdateEvent,
} from "@agentprism/contracts";
import {
  buildInitialMessages,
  buildSystemUser,
  createColumnSnippetRetriever,
  type AgentExecutionContext,
} from "@agentprism/harness";
import {
  createRunState,
  emitStreamEvent,
  emitToolOutcomeEvents,
  eventOf,
  finishEvent,
  formatCapabilityPluginIds,
  recursionLimitFor,
} from "@agentprism/driver-run-support";
import {
  bindRegistryTools,
  contextPolicyMiddleware,
  requireChatModel,
  toLcMessages,
} from "@agentprism/driver-langchain";
import type { ToolAccess } from "@agentprism/harness";
import { FilesystemBackend, createDeepAgent, createFilesystemMiddleware } from "deepagents";

/**
 * Built-in tool names deepagents reserves: createDeepAgent rejects any supplied
 * tool with one of these names (ConfigurationError / TOOL_NAME_COLLISION), and
 * the check is unconditional — a custom FilesystemMiddleware allowlist does not
 * lift it. The registry tools behind them are dropped for this column, and the
 * framework's own versions take over (see READ_ONLY_FILESYSTEM_TOOLS).
 */
export const DEEPAGENTS_RESERVED_TOOL_NAMES: readonly string[] = ["glob", "grep", "ls"];

/**
 * Framework filesystem tools this column keeps, rooted at the Arena workspace:
 * exploration reads real files instead of an in-memory scratch space. Writes and
 * shell execution stay off this list so they keep flowing through tools.execute
 * (authorization, file-diff side channel, RAG invalidation) and cannot bypass the
 * column's toolset policy. `read_file` is mandatory for the middleware.
 */
export const READ_ONLY_FILESYSTEM_TOOLS = ["read_file", "ls", "glob", "grep"] as const;

/** Registry tools that can bind without colliding with the framework's built-ins. */
export function bindableDefinitions(tools: ToolAccess): ReturnType<ToolAccess["registry"]["listDefinitions"]> {
  const reserved = new Set(DEEPAGENTS_RESERVED_TOOL_NAMES);
  return tools.registry.listDefinitions().filter((definition) => !reserved.has(definition.name));
}

/** ToolAccess narrowed to the bindable definitions, so binding never trips the collision check. */
function bindableToolAccess(tools: ToolAccess): ToolAccess {
  return {
    registry: { listDefinitions: () => bindableDefinitions(tools) } as ToolAccess["registry"],
    names: tools.names,
    execute: (name, args, options) => tools.execute(name, args, options),
  };
}

/** Visible text of a completed model call in the raw LangGraph event stream. */
function modelOutputText(raw: unknown): string {
  if (raw === null || typeof raw !== "object") return "";
  const event = raw as { event?: unknown; data?: { output?: unknown } | undefined };
  if (event.event !== "on_chat_model_end") return "";
  const output = event.data?.output as { content?: unknown } | undefined;
  return textFromContent(output?.content).trim();
}

/** Deep Agents Driver: createDeepAgent (planning + filesystem + subagents) + shared context middleware. */
export class DeepAgentsDriver implements AgentDriver {
  readonly frameworkId = "deepagents";
  readonly displayName = "Deep Agents";

  async *run(context: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
    const { config, question, history, tools, tracker } = context;
    const model = requireChatModel(context.llmVendor);
    const label = config.label;
    const state = createRunState(label, tracker, context.clock);
    state.workspaceName = context.workspace.name;

    const { system, user } = buildSystemUser(context);
    tracker.seedPrompt(system, user);
    yield tokenUpdateEvent({ pipeline: label, token_stats: tracker.asDict(), workspace: state.workspaceName });
    const retrieveSnippets = createColumnSnippetRetriever(context.rag, context.workspace);

    const historyCount = history.length;
    yield eventOf({
      type: "thought",
      pipeline: label,
      workspace: state.workspaceName,
      step: 0,
      content:
        `${PIPELINE_BANNER_PREFIX.deepagents} planning+virtual filesystem+subagents · ` +
        `reasoning=${config.reasoning} · prompt=${config.prompt_profile} · ` +
        `context=${config.context}(real trim) · harness=${config.harness} · ` +
        `temp=${config.temperature} · model=${config.model_id} · ` +
        `max_steps=${config.max_steps} · toolset=${config.toolset} · ` +
        `mcp=${String((config as Record<string, unknown>)["mcp_policy"] ?? "off")} · ` +
        `skill=${String((config as Record<string, unknown>)["skill_policy"] ?? "on_demand")} · ` +
        `orchestration=${String((config as Record<string, unknown>)["orchestration"] ?? "direct")} · ` +
        `history_mode=${String((config as Record<string, unknown>)["history_mode"] ?? "minimal")}` +
        (historyCount > 0 ? ` · history=${historyCount}` : "") +
        ` · ${formatCapabilityPluginIds(config)}`,
      turn: context.turn,
      timestamp: context.clock.now(),
      agentId: context.identity.agentId,
    });

    try {
      const extra: ArenaEvent[] = [];
      const lcTools = bindRegistryTools(bindableToolAccess(tools), {
        signal: context.signal,
        onOutcome: (name, outcome) => {
          extra.push(
            ...emitToolOutcomeEvents(label, state.workspaceName, state.step, name, outcome),
          );
        },
      });
      const agent = createDeepAgent({
        model,
        tools: lcTools,
        // prefix (not a bare string): the framework's own profile prompt keeps its
        // planning/filesystem/subagent operating instructions after the Arena prompt.
        systemPrompt: { prefix: system },
        middleware: [
          contextPolicyMiddleware(
            config.context,
            question,
            retrieveSnippets,
            context.contextAnalytics,
            context.contextTuning,
            config.harness,
          ),
          createFilesystemMiddleware({
            backend: new FilesystemBackend({ rootDir: context.workspace.cwd() }),
            tools: [...READ_ONLY_FILESYSTEM_TOOLS],
          }),
        ],
      }).withConfig({
        recursionLimit: recursionLimitFor(config.max_steps),
        signal: context.signal,
      });
      const initialState = { messages: toLcMessages(buildInitialMessages(system, user, history)) };

      let streamedText = "";
      let lastModelText = "";
      for await (const raw of agent.streamEvents(initialState, { version: "v2" })) {
        for (const queued of extra.splice(0)) yield queued;
        const modelText = modelOutputText(raw);
        if (modelText !== "") lastModelText = modelText;
        for (const event of emitStreamEvent(state, raw)) {
          if (event.type === "thought_delta" && typeof event.content === "string") {
            streamedText += event.content;
          }
          yield event;
        }
      }
      for (const queued of extra.splice(0)) yield queued;

      // deepagents' graph node calls the model without token streaming (the raw
      // stream carries on_chat_model_end, never on_chat_model_stream), so the
      // shared translation cannot fill the thought channel. When the last model
      // output never reached it, that output is emitted as the closing thought
      // block — without it the column would report no answer at all.
      if (lastModelText !== "" && !streamedText.includes(lastModelText)) {
        yield eventOf({
          type: "thought_delta",
          pipeline: label,
          step: state.streamingStep ?? state.step,
          content: lastModelText,
          workspace: state.workspaceName,
        });
        yield eventOf({
          type: "thought_end",
          pipeline: label,
          step: state.streamingStep ?? state.step,
          content: "",
          workspace: state.workspaceName,
        });
      }

      yield finishEvent(state, true);
    } catch (error) {
      // Server-side detail log; the client-facing event stays sanitized.
      console.error(`[deepagents-driver] column "${label}" failed:`, error);
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
}
