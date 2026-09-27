/**
 * @file chat-model-adapter
 * @description Adapts LangChain BaseChatModel to the contracts LlmAdapter port.
 *
 * Responsibilities:
 * - Own LC message conversion (llmMessagesToLc)
 * - Provide optional bindTools for the current call
 * - Map responseFormat onto the wire's native constraint (planInvoke)
 * - Extract the vendor usage payload for the run's token tracker (usageOf),
 *   on both the invoke result and the stream's final part
 *
 * Native, verification and the OpenAI Agents model bridge talk only to
 * LlmAdapter; the LangChain-family drivers (LangChain, LangGraph, Deep Agents)
 * read BaseChatModel through ColumnRuntime.llmVendor.
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type AIMessageChunk,
} from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import type {
  LlmAdapter,
  LlmCallOptions,
  LlmInvokeResult,
  LlmMessage,
  LlmStreamPart,
  ToolDefinition,
} from "@agentprism/contracts";
import { extractChunkParts, normalizeToolCalls, textFromContent } from "@agentprism/contracts";

/** OpenAI-style function tool descriptor for ChatModel.bindTools. */
function toBindableTool(definition: ToolDefinition) {
  return {
    type: "function" as const,
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.jsonSchema,
    },
  };
}

/** Converts framework-neutral LlmMessage[] into LangChain BaseMessage[]. */
export function llmMessagesToLc(messages: LlmMessage[]): BaseMessage[] {
  return messages.map((message) => {
    if (message.role === "system") return new SystemMessage(message.content);
    if (message.role === "user") return new HumanMessage(message.content);
    if (message.role === "tool") {
      return new ToolMessage({
        content: message.content,
        tool_call_id: message.toolCallId,
        name: message.name,
      });
    }
    return new AIMessage({
      content: message.content,
      tool_calls: (message.toolCalls ?? []).map((call) => ({
        id: call.id,
        name: call.name,
        args: call.args,
        type: "tool_call" as const,
      })),
    });
  });
}

type ChatRunnable = {
  invoke: BaseChatModel["invoke"];
  stream: BaseChatModel["stream"];
};

function bindToolsIfNeeded(model: BaseChatModel, tools: readonly ToolDefinition[] | undefined): ChatRunnable {
  if (tools === undefined || tools.length === 0) return model as ChatRunnable;
  const binder = model as BaseChatModel & {
    bindTools?: (defs: unknown[]) => unknown;
  };
  if (typeof binder.bindTools !== "function") {
    throw new Error("Current model does not support tool binding (bindTools)");
  }
  return binder.bindTools(tools.map(toBindableTool)) as ChatRunnable;
}

/** Resolved invoke target plus wire-specific call kwargs. */
interface InvokePlan {
  runnable: ChatRunnable;
  invokeKwargs: Record<string, unknown>;
  /** When set, the payload rides this forced tool call's args instead of message text. */
  forcedToolName: string | null;
}

/**
 * Resolves the runnable and call kwargs for one invoke, mapping responseFormat
 * onto the wire's native constraint: OpenAI-family models take json_schema
 * response_format; Anthropic takes a schema tool with forced tool_choice.
 * Model classes with neither mechanism invoke normally — callers validate the
 * payload and fall back to the raw answer (fail-open).
 */
function planInvoke(model: BaseChatModel, options: LlmCallOptions | undefined): InvokePlan {
  const baseKwargs = { signal: options?.signal };
  const format = options?.responseFormat;
  if (format === undefined) {
    return { runnable: bindToolsIfNeeded(model, options?.tools), invokeKwargs: baseKwargs, forcedToolName: null };
  }
  if (model instanceof ChatOpenAI) {
    return {
      runnable: bindToolsIfNeeded(model, options?.tools),
      invokeKwargs: {
        ...baseKwargs,
        response_format: {
          type: "json_schema",
          json_schema: { name: format.name, schema: format.schema, strict: true },
        },
      },
      forcedToolName: null,
    };
  }
  if (model instanceof ChatAnthropic) {
    const binder = model as BaseChatModel & {
      bindTools?: (defs: unknown[], kwargs?: unknown) => ChatRunnable;
    };
    if (typeof binder.bindTools !== "function") {
      throw new Error("Current model does not support tool binding (bindTools)");
    }
    return {
      runnable: binder.bindTools(
        [
          {
            name: format.name,
            description: "Return the final answer through this tool call.",
            input_schema: format.schema,
          },
        ],
        { tool_choice: { type: "tool", name: format.name } },
      ),
      invokeKwargs: baseKwargs,
      forcedToolName: format.name,
    };
  }
  return { runnable: bindToolsIfNeeded(model, options?.tools), invokeKwargs: baseKwargs, forcedToolName: null };
}

/**
 * Extracts the vendor usage payload from an LC response for LlmInvokeResult.usage:
 * usage_metadata (LangChain standard) first, then response_metadata.usage and the
 * legacy token_usage naming. Verification (judge/reflect/evolve) and the structured
 * finalize record this payload onto the run's token tracker; returning undefined
 * here silently drops those calls from the metrics.
 */
function usageOf(response: BaseMessage): Record<string, unknown> | undefined {
  const record = response as unknown as Record<string, unknown>;
  const metadata = record.response_metadata;
  const usage = record.usage_metadata ??
    (metadata !== null && typeof metadata === "object"
      ? (metadata as Record<string, unknown>).usage
      : undefined) ??
    record.token_usage;
  return usage !== null && typeof usage === "object" ? (usage as Record<string, unknown>) : undefined;
}

/** LlmAdapter backed by a LangChain chat model. */
export class ChatModelLlmAdapter implements LlmAdapter {
  constructor(private readonly model: BaseChatModel) {}

  async invoke(messages: LlmMessage[], options?: LlmCallOptions): Promise<LlmInvokeResult> {
    const plan = planInvoke(this.model, options);
    const response = await plan.runnable.invoke(llmMessagesToLc(messages), {
      ...plan.invokeKwargs,
      // Per-call truth for the wire tracer: single-shot invokes are genuinely
      // non-streaming (the SDK snapshot alone reads as stream:false for every path).
      metadata: { wire_stream: false },
    });
    const toolCalls = normalizeToolCalls((response as AIMessage).tool_calls);
    const forced = plan.forcedToolName !== null
      ? toolCalls.find((call) => call.name === plan.forcedToolName)
      : undefined;
    return {
      // A forced-tool reply carries the payload in the tool call args, not message text.
      text: forced !== undefined ? JSON.stringify(forced.args) : textFromContent(response.content),
      toolCalls,
      usage: usageOf(response),
    };
  }

  // Note: responseFormat is intentionally ignored on the streaming path — only
  // single-shot invokes (the structured finalize) use constrained decoding.

  async *stream(messages: LlmMessage[], options?: LlmCallOptions): AsyncIterable<LlmStreamPart> {
    const runnable = bindToolsIfNeeded(this.model, options?.tools);
    const stream = await runnable.stream(llmMessagesToLc(messages), {
      signal: options?.signal,
      // Runnable.stream drives the vendor's streaming transport (SSE, stream:true
      // in the HTTP body); stamp the call so the wire tracer records it.
      metadata: { wire_stream: true },
    });
    let gathered: AIMessageChunk | null = null;
    for await (const chunk of stream) {
      gathered = gathered === null ? (chunk as AIMessageChunk) : gathered.concat(chunk as AIMessageChunk);
      const { thinking, text } = extractChunkParts(chunk);
      if (thinking !== "") yield { thinking };
      if (text !== "") yield { text };
    }
    if (gathered !== null) {
      const toolCalls = normalizeToolCalls(gathered.tool_calls);
      if (toolCalls.length > 0) yield { toolCalls };
      // Provider usage is only known once the stream ends, so it rides a final
      // part: streaming consumers (the OpenAI Agents model bridge and the
      // neutral drivers) need it to report real tokens instead of an estimate.
      const usage = usageOf(gathered);
      if (usage !== undefined) yield { usage };
    }
  }
}

/** Wraps a BaseChatModel as LlmAdapter. */
export function toLlmAdapter(model: BaseChatModel): LlmAdapter {
  return new ChatModelLlmAdapter(model);
}
