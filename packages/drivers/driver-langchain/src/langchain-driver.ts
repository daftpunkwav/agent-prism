/**
 * @file langchain-driver
 * @description create_agent-backed driver: single-agent loop with context middleware.
 *
 * Responsibilities:
 * - Run the agent loop with real context middleware
 * - Guard tool calls against drift
 * - Translate events through the shared translation layer
 *
 * Verification retries are owned by runVerificationLoop outside drivers.
 */

import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { createAgent, createMiddleware, type AgentMiddleware } from "langchain";
import type { ArenaEvent, AgentDriver } from "@agentprism/contracts";
import {
  arenaErrorEvent,
  PIPELINE_BANNER_PREFIX,
  sanitizeErrorMessage,
  textFromContent,
  tokenUpdateEvent,
} from "@agentprism/contracts";
import {
  blockedToolMessageContent,
  createColumnSnippetRetriever,
  injectToolResultReminder,
  applyContextPipeline,
  buildInitialMessages,
  buildSystemUser,
  type AgentExecutionContext,
  type ContextAnalytics,
  type ContextTuning,
} from "@agentprism/harness";
import { createRunState, emitStreamEvent, emitToolOutcomeEvents, eventOf, finishEvent, recursionLimitFor, formatCapabilityPluginIds } from "@agentprism/driver-registry";
import { bindRegistryTools } from "./bind-registry-tools.js";
import { requireChatModel } from "./require-chat-model.js";
import { fromLcMessages, toLcMessages } from "./llm-message-bridge.js";

/** Before every model call: shared context pipeline; tool calls go through the drift guard. */
function contextPolicyMiddleware(
  contextStrategy: string,
  question: string,
  retrieveSnippets: (query: string) => string,
  analytics?: ContextAnalytics,
  contextTuning?: ContextTuning,
  harness?: string,
): AgentMiddleware {
  return createMiddleware({
    name: "contextPolicy",
    wrapModelCall: async (request, handler) => {
      const combined: BaseMessage[] = [...(request.messages ?? [])];
      // Convert to LlmMessage for harness pipeline, then back to LC for create_agent.
      const grounded = toLcMessages(
        applyContextPipeline(fromLcMessages(combined), contextStrategy, { retrieveSnippets, analytics, ...contextTuning }),
      );

      let systemMessage = request.systemMessage;
      let rest = grounded;
      if (grounded.length > 0 && grounded[0] instanceof SystemMessage) {
        const first = grounded[0];
        systemMessage = first as SystemMessage;
        rest = grounded.slice(1);
      }
      const cleaned: BaseMessage[] = [];
      for (const message of rest) {
        if (message instanceof SystemMessage) {
          const text = textFromContent(message.content).trim();
          if (text !== "") cleaned.push(new HumanMessage(`[System supplement]\n${text}`));
          continue;
        }
        cleaned.push(message);
      }
      // LangChain 1.5 rejects a request that changes BOTH systemPrompt and
      // systemMessage; leaving systemPrompt untouched counts as unchanged.
      // The context pipeline owns the system message, so only systemMessage
      // is overwritten here.
      return handler({
        ...request,
        messages: cleaned,
        systemMessage,
      });
    },
    wrapToolCall: async (request, handler) => {
      const call = request.toolCall;
      const toolName = String(call.name ?? "");
      const toolArgs = (call.args && typeof call.args === "object" ? call.args : {}) as Record<string, unknown>;
      const prior: string[] = [];
      const stateMessages = (request.state.messages ?? []) as BaseMessage[];
      for (const message of stateMessages.slice(0, -1)) {
        const calls = (message as AIMessage).tool_calls;
        if (Array.isArray(calls)) {
          for (const toolCall of calls) {
            prior.push(String(toolCall.name ?? ""));
          }
        }
      }
      const blocked = blockedToolMessageContent(question, toolName, toolArgs, prior, harness);
      if (blocked !== null) {
        return new ToolMessage({ content: blocked, tool_call_id: String(call.id ?? "") });
      }
      const result = await handler(request);
      if (result instanceof ToolMessage) {
        return new ToolMessage({
          content: injectToolResultReminder(String(result.content ?? ""), question),
          tool_call_id: result.tool_call_id,
          name: result.name,
        });
      }
      return result;
    },
  });
}

/** LangChain Driver: create_agent monolith + shared context middleware. */
export class LangChainDriver implements AgentDriver {
  readonly frameworkId = "langchain";
  readonly displayName = "LangChain";

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

    const reasoningNote = `reasoning=${config.reasoning} (Tool Calling skeleton)`;
    const historyCount = history.length;
    yield eventOf({
      type: "thought",
      pipeline: label,
      workspace: state.workspaceName,
      step: 0,
      content:
        `${PIPELINE_BANNER_PREFIX.langchain} Tool Calling · prompt=${config.prompt_profile} · ` +
        `context=${config.context}(real trim) · harness=${config.harness} · ` +
        `temp=${config.temperature} · model=${config.model_id} · ` +
        `max_steps=${config.max_steps} · toolset=${config.toolset} · ` +
        `mcp=${String((config as Record<string, unknown>)["mcp_policy"] ?? "off")} · ` +
        `skill=${String((config as Record<string, unknown>)["skill_policy"] ?? "on_demand")} · ` +
        `orchestration=${String((config as Record<string, unknown>)["orchestration"] ?? "direct")} · ` +
        `history_mode=${String((config as Record<string, unknown>)["history_mode"] ?? "minimal")} · ${reasoningNote}` +
        (historyCount > 0 ? ` · history=${historyCount}` : "") +
        ` · ${formatCapabilityPluginIds(config)}`,
      turn: context.turn,
      timestamp: context.clock.now(),
      agentId: context.identity.agentId,
    });

    try {
      const extra: ArenaEvent[] = [];
      const lcTools = bindRegistryTools(tools, {
        signal: context.signal,
        onOutcome: (name, outcome) => {
          extra.push(
            ...emitToolOutcomeEvents(label, state.workspaceName, state.step, name, outcome),
          );
        },
      });
      const agent = createAgent({
        model,
        tools: lcTools,
        systemPrompt: system,
        middleware: [contextPolicyMiddleware(config.context, question, retrieveSnippets, context.contextAnalytics, context.contextTuning, config.harness)],
      }).withConfig({
        recursionLimit: recursionLimitFor(config.max_steps),
        signal: context.signal,
      });
      const initialState = { messages: toLcMessages(buildInitialMessages(system, user, history)) };

      for await (const raw of agent.streamEvents(initialState, { version: "v2" })) {
        for (const queued of extra.splice(0)) yield queued;
        for (const event of emitStreamEvent(state, raw)) {
          yield event;
        }
      }
      for (const queued of extra.splice(0)) yield queued;

      yield finishEvent(state, true);
    } catch (error) {
      // Server-side detail log; the client-facing event stays sanitized.
      console.error(`[langchain-driver] column "${label}" failed:`, error);
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
