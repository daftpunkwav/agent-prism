/**
 * @file llm-message
 * @description Framework-neutral in-loop chat messages for LlmAdapter and context pipelines.
 *
 * Responsibilities:
 * - Define system/user/assistant/tool message variants with tool calls
 * - Provide narrow type guards
 *
 * Distinct from Arena ChatMessage (user|assistant history only): this shape
 * carries system/tool rounds for agent loops.
 */

/** Tool call requested by the model (shared by LlmMessage and LlmAdapter results). */
export interface LlmToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** System instruction turn. */
export interface LlmSystemMessage {
  role: "system";
  content: string;
}

/** User / human turn. */
export interface LlmUserMessage {
  role: "user";
  content: string;
}

/** Assistant turn; may request tools. */
export interface LlmAssistantMessage {
  role: "assistant";
  content: string;
  toolCalls?: LlmToolCall[];
}

/** Tool result turn paired with a prior assistant toolCalls entry. */
export interface LlmToolMessage {
  role: "tool";
  content: string;
  toolCallId: string;
  /** Optional tool name for traces / providers that require it. */
  name?: string;
}

/** One message in an LlmAdapter / harness conversation. */
export type LlmMessage = LlmSystemMessage | LlmUserMessage | LlmAssistantMessage | LlmToolMessage;

interface ContentBlockLike {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
}

/**
 * Visible text from arbitrary content (string or content-block array). Single source:
 * harness message-text, providers chat-model-text, and LC/anthropic chunk shapes all
 * funnel here. Any string .text counts regardless of block type (thinking/tool_use
 * blocks are filtered by their callers, not here); missing text contributes nothing.
 */
export function textFromContent(content: unknown): string {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "string") {
        parts.push(block);
      } else if (block !== null && typeof block === "object") {
        const record = block as Record<string, unknown>;
        if (typeof record.text === "string") {
          parts.push(record.text);
        }
      } else {
        parts.push(String(block));
      }
    }
    return parts.join("");
  }
  return String(content);
}

/** Normalized vendor tool call (drops nameless entries, defaults missing ids). Never returns undefined: empty input yields []. */
export function normalizeToolCalls(raw: unknown): LlmToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: LlmToolCall[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = String(record.name ?? "");
    if (name === "") continue;
    out.push({
      id: String(record.id ?? `call_${out.length}`),
      name,
      args:
        record.args !== null && typeof record.args === "object"
          ? (record.args as Record<string, unknown>)
          : {},
    });
  }
  return out;
}

function chunkPartsFromContent(content: unknown): { thinking: string; text: string } {
  if (typeof content === "string") return { thinking: "", text: content };
  if (!Array.isArray(content)) {
    return { thinking: "", text: content === null || content === undefined ? "" : String(content) };
  }
  const thinkingParts: string[] = [];
  const textParts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      textParts.push(block);
      continue;
    }
    if (block !== null && typeof block === "object") {
      const record = block as ContentBlockLike;
      const blockType = typeof record.type === "string" ? record.type : "";
      if (blockType === "thinking" || blockType === "reasoning" || blockType === "redacted_thinking") {
        thinkingParts.push(String(record.thinking ?? record.text ?? ""));
      } else if (blockType === "text") {
        textParts.push(String(record.text ?? ""));
      } else if (blockType === "tool_use" || blockType === "tool_call" || blockType === "input_json_delta") {
        continue;
      } else if (typeof record.text === "string" && record.text !== "") {
        textParts.push(record.text);
      }
    }
  }
  return { thinking: thinkingParts.join(""), text: textParts.join("") };
}

/**
 * Splits a vendor chunk into thinking vs visible text (OpenAI / Anthropic / LC shapes).
 * Single source for drivers event translation and the providers adapter.
 */
export function extractChunkParts(chunk: unknown): { thinking: string; text: string } {
  if (chunk === null || chunk === undefined) return { thinking: "", text: "" };
  if (typeof chunk === "object" && !Array.isArray(chunk) && !(chunk instanceof String)) {
    const record = chunk as Record<string, unknown>;
    const additional = record.additional_kwargs;
    if (additional !== null && typeof additional === "object") {
      const reasoning = (additional as Record<string, unknown>).reasoning_content;
      if (typeof reasoning === "string" && reasoning !== "") {
        return { thinking: reasoning, text: "" };
      }
    }
    const content = record.content;
    if (content !== null && content !== undefined) {
      return chunkPartsFromContent(content);
    }
    const text = record.text;
    if (typeof text === "string" && text !== "") {
      return { thinking: "", text };
    }
    return { thinking: "", text: "" };
  }
  if (typeof chunk === "string") return { thinking: "", text: chunk };
  return { thinking: "", text: "" };
}

/** Narrows to assistant turns (the only role carrying text/tool calls). */
export function isAssistantMessage(message: LlmMessage): message is LlmAssistantMessage {
  return message.role === "assistant";
}

/** Narrows to tool-result turns for transcript replay. */
export function isToolMessage(message: LlmMessage): message is LlmToolMessage {
  return message.role === "tool";
}

/** Chars per estimated token: the shared char-proxy divisor for budget arithmetic and tool-result size reports. */
export const CHARS_PER_TOKEN = 4;

/** Char-proxy token estimate from a char count (never zero, so empty content still counts). */
export function estimateTokensFromChars(chars: number, charsPerToken: number = CHARS_PER_TOKEN): number {
  return Math.max(1, Math.ceil(chars / charsPerToken));
}
