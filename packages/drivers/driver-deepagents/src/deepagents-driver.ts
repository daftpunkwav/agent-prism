/**
 * @file deepagents-driver
 * @description Deep Agents (LangChain) driver: planning tool, virtual filesystem
 *              and subagents over the LangGraph runtime.
 *
 * Responsibilities:
 * - Run the real createDeepAgent middleware stack over the Arena model port
 * - Drop registry tools whose names the framework reserves, and keep the
 *   framework's own filesystem tools read-only and confined to the workspace
 * - Reject model-supplied patterns too complex for the micromatch/braces
 *   matcher at the shared backend boundary (root agent and subagents alike)
 * - Keep the shared context pipeline and tool drift guard on every model call
 * - Translate the framework's LangGraph event stream into ArenaEvents
 * - Translate a cancelled run (a normally-ended graph stream) into AbortError
 *
 * Uses the arena's ChatModel (llmVendor) and the registry tools, so the column
 * shares the model, tool surface and telemetry with every other backend. The
 * deep agent's own filesystem tools read the real workspace through a
 * FilesystemBackend rooted at the column workspace in virtual mode, which is
 * what confines both absolute and relative paths to that root; writes and shell
 * execution stay off the tool allowlist so real workspace mutations remain on
 * the guarded tools.execute path.
 */

import type { ArenaEvent, AgentDriver } from "@agentprism/contracts";
import {
  PIPELINE_BANNER_PREFIX,
  arenaErrorEvent,
  sanitizeErrorMessage,
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
  modelOutputText,
  recursionLimitFor,
} from "@agentprism/driver-run-support";
import {
  bindRegistryTools,
  contextPolicyMiddleware,
  requireChatModel,
  toLcMessages,
  type BindableToolAccess,
} from "@agentprism/driver-langchain";
import type { ToolAccess } from "@agentprism/harness";
import { createDeepAgent, createFilesystemMiddleware } from "deepagents";
import { GuardedFilesystemBackend } from "./guarded-filesystem-backend.js";

/**
 * Built-in tool names deepagents reserves: createDeepAgent rejects any supplied
 * tool with one of these names (ConfigurationError / TOOL_NAME_COLLISION), and
 * the check is unconditional — a custom FilesystemMiddleware allowlist does not
 * lift it. The registry tools behind them are dropped for this column, and the
 * framework's own versions take over (see READ_ONLY_FILESYSTEM_TOOLS).
 *
 * The set mirrors the framework's internal BUILTIN_TOOL_NAMES (filesystem +
 * async-subagent tools + "task"), which the package does not export; it must be
 * re-checked whenever the `deepagents` dependency is bumped. Dropping too little
 * fails the whole column at construction, so the list is deliberately complete:
 * a collision with any unlisted reserved name would abort the run instead of
 * dropping that one tool.
 */
export const DEEPAGENTS_RESERVED_TOOL_NAMES: readonly string[] = [
  // FilesystemMiddleware (FILESYSTEM_TOOL_NAMES)
  "ls",
  "read_file",
  "write_file",
  "edit_file",
  "delete",
  "glob",
  "grep",
  "execute",
  // Async subagent middleware (ASYNC_TASK_TOOL_NAMES)
  "start_async_task",
  "check_async_task",
  "update_async_task",
  "cancel_async_task",
  "list_async_tasks",
  // Subagent middleware
  "task",
];

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

/** Tool access narrowed to the bindable definitions, so binding never trips the collision check. */
function bindableToolAccess(tools: ToolAccess): BindableToolAccess {
  return {
    registry: { listDefinitions: () => bindableDefinitions(tools) },
    execute: (name, args, options) => tools.execute(name, args, options),
  };
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
        // A plain string: the framework normalizes it to { prefix }, so the
        // Arena prompt lands before the framework's own profile prompt and the
        // planning/filesystem/subagent operating instructions stay after it.
        // The structured { prefix } form is deprecated upstream (removed in the
        // next major release), so the string form is the durable spelling.
        systemPrompt: system,
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
            // virtualMode is what confines the backend to rootDir: without it the
            // framework's own read tools accept absolute paths (and resolve relative
            // ones against the host process cwd), reading files outside the Arena
            // workspace and bypassing the scoped tool filesystem entirely.
            // GuardedFilesystemBackend is also the pattern guard's choke point:
            // deepagents hands this one backend instance to the root agent AND to
            // every generated subagent's own filesystem middleware, while root
            // custom middleware is not merged into subagents — so the guard has
            // to live here to cover delegated glob/grep calls too.
            backend: new GuardedFilesystemBackend({ rootDir: context.workspace.cwd(), virtualMode: true }),
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

      // A cancelled run ends its graph stream normally once the in-flight node
      // returns (LangGraph only checks the signal between nodes), so without this
      // checkpoint the column would report a successful, partial-or-empty answer.
      // Same abort checkpoint the harness uses for its nested runs.
      if (context.signal?.aborted === true) {
        const aborted = new Error("Aborted");
        aborted.name = "AbortError";
        throw aborted;
      }

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
      // Cancellation is not a column failure: the abort error leaves untouched,
      // exactly like every other backend's abort path.
      if ((error as Error)?.name === "AbortError") throw error;
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
