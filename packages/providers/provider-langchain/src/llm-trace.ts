/**
 * @file llm-trace
 * @description LangChain callback handler that captures raw LLM wire traffic.
 *
 * Responsibilities:
 * - Serialize every chat model request (messages + bound tools + invocation
 *   parameters) into LlmWireMessage[] plus the vendor's own params snapshot
 * - Serialize every chat model response (text / reasoning / tool calls / usage / finish reason)
 * - Report latency (total + first token) and wire errors through a caller-provided sink
 *
 * Capture is full fidelity by product decision: messages are never clipped, so
 * the raw log shows exactly what crossed the wire (retention is the trace
 * store's concern, not the capture's). Fail-open by design: a tracing defect
 * must never break the agent loop, so every handler body swallows and logs its
 * own exceptions. Framework wiring only — no business policy here; the builder
 * domain owns persistence, sequencing, and delivery.
 */

import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Serialized } from "@langchain/core/load/serializable";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatGeneration, LLMResult } from "@langchain/core/outputs";
import type { LlmWireMessage, LlmWireResponse, LlmWireSink, LlmWireToolCall } from "@agentprism/contracts";

/** Maximum concurrent runs tracked for latency bookkeeping (leak guard). */
const MAX_TRACKED_RUNS = 256;

/**
 * Key pattern stripped from captured invocation params (defense in depth: params
 * should never carry secrets). `token` matches only as a full key so legitimate
 * parameters like `max_tokens` survive.
 */
const SECRET_KEY_PATTERN = /api[_-]?key|authorization|secret|credential|password|^token$/i;

interface RunTiming {
  startedAt: number;
  firstTokenAt: number | null;
  model: string;
}

/**
 * Strips secret-looking keys from the captured invocation params snapshot
 * (recursive, two levels — params are flat vendor bodies in practice). A vendor
 * SDK that ever embeds credentials in params must not leak them into traces.
 */
function redactParams(value: unknown, depth = 0): Record<string, unknown> {
  const source = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    if (depth < 2 && item !== null && typeof item === "object" && !Array.isArray(item)) {
      out[key] = redactParams(item, depth + 1);
    } else if (depth < 2 && Array.isArray(item)) {
      out[key] = item.map((entry) =>
        entry !== null && typeof entry === "object" && !Array.isArray(entry) ? redactParams(entry, depth + 1) : entry,
      );
    } else {
      out[key] = item;
    }
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Extracts reasoning text from LangChain content blocks (Anthropic thinking etc.). */
function reasoningFromContentBlocks(blocks: unknown[]): string {
  let reasoning = "";
  for (const block of blocks) {
    if (block === null || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (record.type === "thinking" && typeof record.thinking === "string") {
      reasoning += record.thinking;
    } else if (record.type === "reasoning_content" && typeof record.reasoning_content === "string") {
      reasoning += record.reasoning_content;
    }
  }
  return reasoning;
}

function toolCallsFromRecord(record: Record<string, unknown>): LlmWireToolCall[] {
  const raw = record.tool_calls;
  if (!Array.isArray(raw)) return [];
  const calls: LlmWireToolCall[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const call = item as Record<string, unknown>;
    const name = typeof call.name === "string" ? call.name : "";
    if (name === "") continue;
    calls.push({
      id: typeof call.id === "string" ? call.id : "",
      name,
      args: asRecord(call.args),
    });
  }
  return calls;
}

/** Maps a LangChain message type to the wire role vocabulary. */
function wireRole(type: string): LlmWireMessage["role"] {
  if (type === "human") return "user";
  if (type === "ai") return "assistant";
  if (type === "tool") return "tool";
  return "system";
}

/** Serializes one LangChain message into the wire view (content + reasoning + tool calls). */
export function serializeWireMessage(message: BaseMessage): LlmWireMessage {
  const record = message as unknown as Record<string, unknown>;
  const type = typeof message.getType === "function" ? message.getType() : "generic";
  const role = wireRole(type);

  let content = "";
  let reasoning = "";
  const rawContent = message.content;
  if (typeof rawContent === "string") {
    content = rawContent;
    const reasoningContent = record.reasoning_content;
    if (typeof reasoningContent === "string") reasoning = reasoningContent;
  } else if (Array.isArray(rawContent)) {
    const textParts: string[] = [];
    for (const block of rawContent) {
      if (typeof block === "string") {
        textParts.push(block);
        continue;
      }
      const blockRecord = asRecord(block);
      if (blockRecord.type === "text" && typeof blockRecord.text === "string") {
        textParts.push(blockRecord.text);
      }
    }
    content = textParts.join("");
    reasoning = reasoningFromContentBlocks(rawContent);
  }

  const additional = asRecord(message.additional_kwargs);
  let effectiveReasoning = reasoning;
  if (effectiveReasoning === "" && typeof additional.reasoning_content === "string") {
    effectiveReasoning = additional.reasoning_content;
  }

  return {
    role,
    content,
    reasoning: effectiveReasoning,
    tool_calls: toolCallsFromRecord(record),
    tool_call_id: typeof record.tool_call_id === "string" ? record.tool_call_id : "",
    name: typeof record.name === "string" ? record.name : "",
    // Full-fidelity capture: never clipped, so this flag is always false today;
    // the field stays for wire-schema stability.
    truncated: false,
  };
}

/** Reads the model name out of the serialized constructor payload. */
function modelFromSerialized(serialized: Serialized | undefined): string {
  const kwargs = asRecord(asRecord(serialized).kwargs);
  for (const key of ["model", "model_name", "model_id", "modelKwargs"]) {
    const value = kwargs[key];
    if (typeof value === "string" && value !== "") return value;
  }
  const nested = asRecord(kwargs.modelKwargs);
  return typeof nested.model === "string" ? nested.model : "";
}

/** Serializes the first generation (terminal for single-prompt calls) of an LLMResult into the wire response view. */
export function serializeWireResponse(result: LLMResult, model: string): LlmWireResponse {
  const generation = result.generations?.[0]?.[0] as ChatGeneration | undefined;
  if (generation === undefined || generation.message === undefined) {
    return { model, text: "", reasoning: "", tool_calls: [], usage: null, finish_reason: "", truncated: false };
  }
  const wire = serializeWireMessage(generation.message);
  const record = generation.message as unknown as Record<string, unknown>;
  const metadata = asRecord(record.response_metadata);
  const usageMetadata = asRecord(record.usage_metadata);
  const llmOutput = asRecord(result.llmOutput);
  const tokenUsage = asRecord(llmOutput.tokenUsage);

  // Number() parses numeric strings (vendor compat) but yields NaN on garbage, which would
  // corrupt trace JSON (NaN serializes as null); clamp non-finite values to 0.
  const finite = (value: unknown): number => {
    const num = Number(value ?? 0);
    return Number.isFinite(num) ? num : 0;
  };
  const usage =
    usageMetadata.input_tokens !== undefined || usageMetadata.output_tokens !== undefined
      ? {
          input_tokens: finite(usageMetadata.input_tokens),
          output_tokens: finite(usageMetadata.output_tokens),
          total_tokens: finite(usageMetadata.total_tokens),
        }
      : tokenUsage.totalTokens !== undefined
        ? {
            input_tokens: finite(tokenUsage.promptTokens),
            output_tokens: finite(tokenUsage.completionTokens),
            total_tokens: finite(tokenUsage.totalTokens),
          }
        : null;

  const finishReason =
    typeof metadata.finish_reason === "string"
      ? metadata.finish_reason
      : typeof metadata.stop_reason === "string"
        ? metadata.stop_reason
        : "";

  const anyTruncated = wire.truncated;
  return {
    model,
    text: wire.content,
    reasoning: wire.reasoning,
    tool_calls: wire.tool_calls,
    usage,
    finish_reason: finishReason,
    truncated: anyTruncated,
  };
}

/** Options for the wire tracer factory. */
export interface LlmWireTraceHandlerOptions {
  sink: LlmWireSink;
  /** Injected time source (ms epoch); the handler never reads system time directly. */
  now: () => number;
  /** Returns the tool names currently authorized for the session (attached to requests). */
  boundToolNames?: () => string[];
}

/**
 * Builds the per-model callback handler. Attach via createChatModel's `callbacks`
 * option so every call (bound or not) flows through this handler.
 */
export function createLlmWireTraceHandler(options: LlmWireTraceHandlerOptions): BaseCallbackHandler {
  const runTimings = new Map<string, RunTiming>();

  const trackRun = (runId: string, model: string): void => {
    runTimings.set(runId, { startedAt: options.now(), firstTokenAt: null, model });
    if (runTimings.size > MAX_TRACKED_RUNS) {
      const oldest = runTimings.keys().next().value;
      if (oldest !== undefined) runTimings.delete(oldest);
    }
  };

  const finishRun = (runId: string): { timing: RunTiming; durationMs: number } | null => {
    const timing = runTimings.get(runId);
    if (timing === undefined) return null;
    runTimings.delete(runId);
    return { timing, durationMs: Math.max(0, options.now() - timing.startedAt) };
  };

  class LlmWireTraceHandler extends BaseCallbackHandler {
    name = "LlmWireTraceHandler";

    override handleChatModelStart(
      serialized: Serialized,
      messages: BaseMessage[][],
      runId: string,
      _parentRunId?: string,
      extraParams?: Record<string, unknown>,
      _tags?: string[],
      _metadata?: Record<string, unknown>,
    ): void {
      try {
        const model = modelFromSerialized(serialized);
        trackRun(runId, model);
        const flat = (messages[0] ?? []).map(serializeWireMessage);
        const boundTools = options.boundToolNames?.() ?? [];
        // The SDK's own invocation snapshot (temperature, top_p, penalties,
        // max_tokens, stream, bound tool definitions as applicable): the proof
        // of what was actually sent, redacted against secret-looking keys.
        const params = redactParams(extraParams?.invocation_params);
        // Vendor SDKs omit falsy sampling params from their snapshot (a 0
        // temperature is a legal, common setting): backfill from the model's
        // constructor kwargs so the log never reads as "no temperature sent".
        const kwargs = asRecord(asRecord(serialized).kwargs);
        const backfill = (key: string, sources: string[]): void => {
          if (key in params) return;
          for (const source of sources) {
            const value = kwargs[source];
            if (value !== undefined) {
              params[key] = value;
              return;
            }
          }
        };
        backfill("temperature", ["temperature"]);
        backfill("top_p", ["topP", "top_p"]);
        backfill("max_tokens", ["maxTokens", "max_tokens", "maxCompletionTokens"]);
        options.sink({
          kind: "llm_request",
          title: `LLM request → ${model} (${flat.length} messages, tools: ${boundTools.join(", ") || "none"})`,
          data: { model, messages: flat, tools: boundTools, params },
          durationMs: null,
        });
      } catch (error) {
        console.warn(`[llm-trace] request capture failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    override handleLLMNewToken(...args: Parameters<NonNullable<BaseCallbackHandler["handleLLMNewToken"]>>): void {
      try {
        // Token payloads are reconstructed from the final message; only first-token latency is tracked here.
        const runId = args[2];
        const timing = runTimings.get(runId);
        if (timing !== undefined && timing.firstTokenAt === null) {
          timing.firstTokenAt = options.now();
        }
      } catch (error) {
        console.warn(`[llm-trace] token timing capture failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    override handleLLMEnd(output: LLMResult, runId: string): void {
      try {
        const finished = finishRun(runId);
        const model = finished?.timing.model ?? "";
        const response = serializeWireResponse(output, model);
        const firstTokenMs =
          finished !== null && finished.timing.firstTokenAt !== null
            ? Math.max(0, finished.timing.firstTokenAt - finished.timing.startedAt)
            : null;
        options.sink({
          kind: "llm_response",
          title: `LLM response ← ${model} (${response.tool_calls.length} tool calls)`,
          data: { ...response, first_token_ms: firstTokenMs } as unknown as Record<string, unknown>,
          durationMs: finished?.durationMs ?? null,
        });
      } catch (error) {
        console.warn(`[llm-trace] response capture failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    override handleLLMError(err: Error, runId: string): void {
      try {
        const finished = finishRun(runId);
        options.sink({
          kind: "llm_error",
          title: `LLM error: ${err.message.slice(0, 200)}`,
          data: { model: finished?.timing.model ?? "", error: err.message },
          durationMs: finished?.durationMs ?? null,
        });
      } catch (error) {
        console.warn(`[llm-trace] error capture failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return new LlmWireTraceHandler();
}
