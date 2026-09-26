/**
 * @file llm-adapter
 * @description Port for model invocation without framework types.
 *
 * Responsibilities:
 * - Define stream/invoke entry points and result shapes over LlmMessage
 *
 * Drivers and verification policies depend only on this interface; concrete
 * Chat SDK classes stay behind the providers adapter. The LangChain-family
 * drivers (LangChain, LangGraph, Deep Agents) and the OpenAI Agents model
 * bridge convert at the harness/adapter boundary.
 */

import type { LlmMessage, LlmToolCall } from "./llm-message.js";
import type { LlmResponseFormat } from "./structured-output.js";
import type { ToolDefinition } from "./tool-registry.js";

export type { LlmToolCall } from "./llm-message.js";
export type { LlmResponseFormat } from "./structured-output.js";

/** One unit of streamed model output (text, thinking, and/or tool calls). */
export interface LlmStreamPart {
  text?: string;
  thinking?: string;
  toolCalls?: LlmToolCall[];
  /** Vendor-specific usage payload when the provider reports it mid-stream. */
  usage?: Record<string, unknown>;
}

/** Result of a non-streaming invoke. */
export interface LlmInvokeResult {
  text: string;
  toolCalls: LlmToolCall[];
  usage?: Record<string, unknown>;
}

/** Per-call options for stream / invoke. */
export interface LlmCallOptions {
  signal?: AbortSignal;
  /**
   * When non-empty, bind these tool schemas for this call only.
   * Handlers are NOT invoked here — the driver executes tools via ToolRegistry.
   */
  tools?: readonly ToolDefinition[];
  /**
   * When set, request schema-constrained output for this call. The adapter maps
   * it to the wire's native mechanism (OpenAI response_format, Anthropic forced
   * tool choice); streaming paths may ignore it — only single-shot invokes
   * (e.g. the structured finalize step) rely on it.
   */
  responseFormat?: LlmResponseFormat;
}

/**
 * Framework-neutral LLM port. Messages use LlmMessage (system/user/assistant/tool).
 * Arena ChatMessage history is converted at the agent/harness boundary.
 */
export interface LlmAdapter {
  stream(messages: LlmMessage[], options?: LlmCallOptions): AsyncIterable<LlmStreamPart>;
  invoke(messages: LlmMessage[], options?: LlmCallOptions): Promise<LlmInvokeResult>;
}
