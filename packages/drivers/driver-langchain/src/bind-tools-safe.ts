/**
 * @file bind-tools-safe
 * @description LangChain-only helper making bindTools an optional capability.
 *
 * Responsibilities:
 * - Bind tools only when the model supports them
 *
 * Lives in drivers; the harness must stay free of @langchain.
 */

import type { Runnable } from "@langchain/core/runnables";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

/** bindTools is optional; models without tool support fail loudly. */
export function bindToolsSafe(model: BaseChatModel, tools: StructuredToolInterface[]): Runnable {
  const binder = model as BaseChatModel & {
    bindTools?: (tools: StructuredToolInterface[]) => Runnable;
  };
  if (typeof binder.bindTools !== "function") {
    throw new Error("Current model does not support tool binding (bindTools)");
  }
  return binder.bindTools(tools);
}
