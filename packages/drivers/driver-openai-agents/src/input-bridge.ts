/**
 * @file input-bridge
 * @description Agents SDK input items ↔ neutral LlmMessages.
 *
 * Responsibilities:
 * - Convert the SDK's Responses-shaped input items into LlmMessage
 * - Convert a ModelResponse output list into the SDK's AgentOutputItem shape
 *
 * The Agents SDK describes conversation state with Responses API items
 * (roles, function_call, function_call_result); the Arena's ports speak
 * LlmMessage. All knowledge of both shapes lives here.
 */

import type { AgentInputItem } from "@openai/agents";
import type { LlmMessage, LlmToolCall } from "@agentprism/contracts";

/** One input item as the SDK hands it to a Model (loosely typed by design). */
interface ItemLike {
  type?: unknown;
  role?: unknown;
  content?: unknown;
  name?: unknown;
  arguments?: unknown;
  callId?: unknown;
  output?: unknown;
  text?: unknown;
}

/** Flattens a Responses-style content value (string or block array) into text. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    const text = (block as ItemLike).text;
    if (typeof text === "string") parts.push(text);
  }
  return parts.join("");
}

/** Parses a function_call's JSON argument string; unparseable args become `{ input }`. */
function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { input: parsed };
  } catch {
    return { input: raw };
  }
}

/**
 * Converts one function_call_result item's output into tool-result text.
 * The SDK carries either a plain string or a list of output blocks.
 */
function toolOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output !== null && typeof output === "object" && !Array.isArray(output)) {
    const text = (output as ItemLike).text;
    if (typeof text === "string") return text;
  }
  return contentText(output);
}

/**
 * Converts neutral messages into the SDK's run input. The system turn is dropped:
 * it travels as the agent's instructions, and duplicating it would send it twice.
 * Assistant turns carrying tool calls expand into one function_call item per call.
 *
 * The items are built as the SDK's own protocol objects; the casts below mark the
 * boundary where LlmMessage is projected onto them (round-tripped by this module's
 * tests), so the SDK receives exactly the item kinds it knows.
 */
export function fromLlmMessages(messages: readonly LlmMessage[]): AgentInputItem[] {
  const items: AgentInputItem[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      items.push({
        type: "function_call_result",
        callId: message.toolCallId,
        ...(message.name !== undefined && message.name !== "" ? { name: message.name } : {}),
        output: message.content,
      } as AgentInputItem);
      continue;
    }
    if (message.role === "user") {
      items.push({ role: "user", content: message.content } as AgentInputItem);
      continue;
    }
    for (const call of message.toolCalls ?? []) {
      items.push({
        type: "function_call",
        callId: call.id,
        name: call.name,
        arguments: JSON.stringify(call.args ?? {}),
      } as AgentInputItem);
    }
    if (message.content !== "" || (message.toolCalls ?? []).length === 0) {
      // Assistant content is an output_text block list, not a bare string.
      items.push({
        role: "assistant",
        content: [{ type: "output_text", text: message.content }],
      } as AgentInputItem);
    }
  }
  return items;
}

/**
 * Converts the SDK's run input into neutral messages. Unsupported item kinds
 * (reasoning, images, hosted tool traffic) are skipped: the Arena's tool surface
 * has no vision or hosted tools, and dropping them keeps the model call valid.
 */
export function toLlmMessages(input: string | readonly unknown[]): LlmMessage[] {
  if (typeof input === "string") return [{ role: "user", content: input }];
  const messages: LlmMessage[] = [];
  for (const entry of input) {
    if (entry === null || typeof entry !== "object") {
      if (typeof entry === "string") messages.push({ role: "user", content: entry });
      continue;
    }
    const item = entry as ItemLike;
    if (item.type === "function_call") {
      const call: LlmToolCall = {
        id: typeof item.callId === "string" ? item.callId : "",
        name: typeof item.name === "string" ? item.name : "",
        args: parseArguments(item.arguments),
      };
      // Consecutive calls from one assistant turn share a message (the SDK
      // emits one item per call, the neutral shape one message per turn).
      const last = messages[messages.length - 1];
      if (last?.role === "assistant") {
        last.toolCalls = [...(last.toolCalls ?? []), call];
      } else {
        messages.push({ role: "assistant", content: "", toolCalls: [call] });
      }
      continue;
    }
    if (item.type === "function_call_result") {
      messages.push({
        role: "tool",
        content: toolOutputText(item.output),
        toolCallId: typeof item.callId === "string" ? item.callId : "",
        ...(typeof item.name === "string" && item.name !== "" ? { name: item.name } : {}),
      });
      continue;
    }
    const role = item.role;
    if (role === "system" || role === "developer") {
      messages.push({ role: "system", content: contentText(item.content) });
      continue;
    }
    if (role === "assistant") {
      messages.push({ role: "assistant", content: contentText(item.content) });
      continue;
    }
    if (role === "user") {
      messages.push({ role: "user", content: contentText(item.content) });
    }
  }
  return messages;
}
