/**
 * @file require-chat-model
 * @description Narrows ColumnRuntime.llmVendor to a LangChain BaseChatModel.
 *
 * Responsibilities:
 * - Assert and return the BaseChatModel behind ColumnRuntime.llmVendor
 *
 * Lives in the langchain driver package so contracts stay vendor-free;
 * LC/LG tool loops cast here.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

/** Minimal duck-type check (presence of invoke); throws otherwise. */
export function requireChatModel(llmVendor: unknown): BaseChatModel {
  if (
    llmVendor !== null &&
    typeof llmVendor === "object" &&
    "invoke" in llmVendor &&
    typeof (llmVendor as { invoke: unknown }).invoke === "function"
  ) {
    return llmVendor as BaseChatModel;
  }
  throw new Error("Column runtime is missing a usable ChatModel (llmVendor)");
}
