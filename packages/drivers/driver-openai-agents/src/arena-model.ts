/**
 * @file arena-model
 * @description Agents SDK Model implemented over the Arena's framework-neutral LLM port.
 *
 * Responsibilities:
 * - Serve getResponse / getStreamedResponse from the injected LlmAdapter
 * - Emit the SDK's protocol stream events (response_started → deltas → response_done)
 * - Project tool schemas and usage into the SDK's shapes
 *
 * The Agents SDK owns the run loop, handoffs, guardrails and tool dispatch; only
 * the model transport is adapted, exactly like the AutoGen/CrewAI bridges. Routing
 * through LlmAdapter keeps one provider configuration, one wire trace and one token
 * ledger for every column. Model settings (temperature, max tokens, thinking) are
 * already baked into the configured model, so request.modelSettings is not re-applied.
 */

import type { LlmAdapter, LlmMessage, LlmToolCall, ToolDefinition } from "@agentprism/contracts";
import { extractLlmUsage } from "@agentprism/harness";
import type { AgentOutputItem, Model, ModelRequest, ModelResponse, StreamEvent } from "@openai/agents";
import { Usage } from "@openai/agents";
import { toLlmMessages } from "./input-bridge.js";

/** Per-call lifecycle hooks letting the driver keep step/turn accounting and stream text. */
export interface ArenaModelHooks {
  /** Fired before the underlying model call starts (one SDK turn). */
  onRequestStart?: () => void;
  /** Fired after the underlying model call settles, success or failure. */
  onRequestEnd?: () => void;
  /** Visible text delta of the current call. */
  onTextDelta?: (text: string) => void;
  /** Thinking delta of the current call (Arena renders these on the thinking channel). */
  onReasoning?: (text: string) => void;
  /** Vendor usage payload of the current call, for the run's token ledger. */
  onUsage?: (usage: Record<string, unknown> | undefined) => void;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Projects the vendor usage payload into the SDK's Usage shape. */
export function toSdkUsage(usage: Record<string, unknown> | undefined): Usage {
  const extracted = extractLlmUsage({ usage_metadata: usage }) ?? { inputTokens: 0, outputTokens: 0 };
  const inputDetails = (usage?.["prompt_tokens_details"] ?? usage?.["input_tokens_details"]) as
    | Record<string, unknown>
    | undefined;
  const outputDetails = (usage?.["completion_tokens_details"] ?? usage?.["output_tokens_details"]) as
    | Record<string, unknown>
    | undefined;
  const cached = readNumber(inputDetails?.["cached_tokens"]);
  const reasoning = readNumber(outputDetails?.["reasoning_tokens"]);
  return new Usage({
    inputTokens: extracted.inputTokens,
    outputTokens: extracted.outputTokens,
    totalTokens: extracted.inputTokens + extracted.outputTokens,
    // The SDK aggregates detail maps as one entry per request, hence the arrays.
    inputTokensDetails: [cached > 0 ? { cached_tokens: cached } : {}],
    outputTokensDetails: [reasoning > 0 ? { reasoning_tokens: reasoning } : {}],
  });
}

/** Fallback schema-only definition: the LLM port reads name/description/jsonSchema and never executes handlers. */
function schemaOnlyTool(name: string, description: string, jsonSchema: Record<string, unknown>): ToolDefinition {
  return {
    name,
    description,
    jsonSchema,
    mutatesWorkspace: false,
    execute: async () => ({ result: "", fileDiff: null, ok: false }),
  };
}

/**
 * The LLM port's view of the tools this request may call. Registry definitions
 * come through resolveTool (they carry the same schema the model sees);
 * SDK-built tools with no registry entry (handoff tools) get a schema-only
 * placeholder, which is never executed here — the SDK dispatches them itself.
 */
function toolDefinitions(request: ModelRequest, resolveTool: (name: string) => ToolDefinition | undefined): ToolDefinition[] {
  const definitions: ToolDefinition[] = [];
  for (const tool of request.tools) {
    if (tool.type !== "function") continue;
    if (typeof tool.name !== "string" || tool.name === "") continue;
    const registered = resolveTool(tool.name);
    if (registered !== undefined) {
      definitions.push(registered);
      continue;
    }
    definitions.push(
      schemaOnlyTool(
        tool.name,
        typeof tool.description === "string" ? tool.description : "",
        (tool.parameters ?? { type: "object", properties: {} }) as Record<string, unknown>,
      ),
    );
  }
  return definitions;
}

/** Neutral messages for one request: system instructions first, then the run input. */
function requestMessages(request: ModelRequest): LlmMessage[] {
  const messages = toLlmMessages(request.input);
  const instructions = request.systemInstructions;
  if (typeof instructions === "string" && instructions.trim() !== "") {
    return [{ role: "system", content: instructions }, ...messages];
  }
  return messages;
}

/** Assistant message item carrying the model's visible text. */
function messageItem(id: string, text: string): AgentOutputItem {
  return {
    id,
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, providerData: { annotations: [] } }],
  } as AgentOutputItem;
}

/** Function-call item; the SDK re-parses `arguments` as JSON. */
function functionCallItem(call: LlmToolCall): AgentOutputItem {
  return {
    type: "function_call",
    id: `fc_${call.id}`,
    callId: call.id,
    name: call.name,
    arguments: JSON.stringify(call.args ?? {}),
  } as AgentOutputItem;
}

/** Reasoning item; the SDK reads `rawContent` to replay the thinking block. */
function reasoningItem(text: string): AgentOutputItem {
  return {
    type: "reasoning",
    content: [],
    rawContent: [{ type: "reasoning_text", text }],
  } as AgentOutputItem;
}

/** Builds the output list from one completed call (text, thinking, tool calls). */
export function toOutputItems(id: string, text: string, reasoning: string, calls: readonly LlmToolCall[]): AgentOutputItem[] {
  const output: AgentOutputItem[] = [];
  if (reasoning !== "") output.push(reasoningItem(reasoning));
  if (text !== "") output.push(messageItem(id, text));
  for (const call of calls) output.push(functionCallItem(call));
  return output;
}

/** Agents SDK Model backed by the Arena's LlmAdapter. */
export class ArenaModel implements Model {
  private sequence = 0;

  constructor(
    private readonly llm: LlmAdapter,
    private readonly resolveTool: (name: string) => ToolDefinition | undefined = () => undefined,
    private readonly hooks: ArenaModelHooks = {},
  ) {}

  /** Synthetic response id; the Arena's models are stateless, so nothing references it back. */
  private nextResponseId(): string {
    this.sequence += 1;
    return `arena-${this.sequence}`;
  }

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const tools = toolDefinitions(request, this.resolveTool);
    this.hooks.onRequestStart?.();
    let result;
    try {
      result = await this.llm.invoke(requestMessages(request), {
        ...(tools.length > 0 ? { tools } : {}),
        ...(request.signal !== undefined ? { signal: request.signal } : {}),
      });
    } finally {
      this.hooks.onRequestEnd?.();
    }
    this.hooks.onUsage?.(result.usage);
    const id = this.nextResponseId();
    return {
      usage: toSdkUsage(result.usage),
      output: toOutputItems(id, result.text, "", result.toolCalls),
      responseId: id,
    };
  }

  async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    const tools = toolDefinitions(request, this.resolveTool);
    const id = this.nextResponseId();
    yield { type: "response_started", providerData: {} } as StreamEvent;

    let text = "";
    let reasoning = "";
    let usage: Record<string, unknown> | undefined;
    const calls: LlmToolCall[] = [];
    this.hooks.onRequestStart?.();
    try {
      for await (const part of this.llm.stream(requestMessages(request), {
        ...(tools.length > 0 ? { tools } : {}),
        ...(request.signal !== undefined ? { signal: request.signal } : {}),
      })) {
        if (part.thinking !== undefined && part.thinking !== "") {
          reasoning += part.thinking;
          this.hooks.onReasoning?.(part.thinking);
        }
        if (part.text !== undefined && part.text !== "") {
          text += part.text;
          this.hooks.onTextDelta?.(part.text);
          yield { type: "output_text_delta", delta: part.text, providerData: {} } as StreamEvent;
        }
        if (part.toolCalls !== undefined && part.toolCalls.length > 0) calls.push(...part.toolCalls);
        if (part.usage !== undefined) usage = part.usage;
      }
    } finally {
      this.hooks.onRequestEnd?.();
    }
    this.hooks.onUsage?.(usage);

    yield {
      type: "response_done",
      response: {
        id,
        usage: toSdkUsage(usage),
        output: toOutputItems(id, text, reasoning, calls),
      },
    } as StreamEvent;
  }
}
