/**
 * @file tool-bridge
 * @description Adapts column ToolAccess into Agents SDK function tools.
 *
 * Responsibilities:
 * - Route every execute through tools.execute (the shared guarded path)
 * - Apply the same drift guard and result reminder the LangChain column uses
 * - Project the registry's JSON Schema into the SDK's non-strict object shape
 *
 * The registry schema stays the single source: the model sees the same
 * parameters every other column binds.
 */

import type { ToolExecutionResult } from "@agentprism/contracts";
import { normalizeToolCallArgs } from "@agentprism/driver-run-support";
import { blockedToolMessageContent, injectToolResultReminder, type ToolAccess } from "@agentprism/harness";
import { tool as agentTool } from "@openai/agents";

/**
 * Non-strict object schema the SDK forwards verbatim. Declared locally because
 * the SDK's own `JsonObjectSchemaNonStrict` is not part of its public exports;
 * this shape satisfies it structurally (object, explicit required list, open
 * additional properties) so no cast is needed.
 */
export interface ArenaToolParameters {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: true;
}

/** Projects a registry tool's JSON Schema into the SDK's non-strict parameter shape. */
export function toToolParameters(jsonSchema: Record<string, unknown>): ArenaToolParameters {
  const properties = (jsonSchema["properties"] ?? {}) as Record<string, Record<string, unknown>>;
  const required = Array.isArray(jsonSchema["required"])
    ? jsonSchema["required"].filter((key): key is string => typeof key === "string")
    : [];
  return { type: "object", properties, required, additionalProperties: true };
}

export interface AgentToolBridgeOptions {
  /** Task text the drift guard anchors on. */
  question: string;
  /** Harness level; "bare" disables the drift guard (matches the other columns). */
  harness: string;
  signal?: AbortSignal;
  /** Fired after every real execute with the outcome (fileDiff rides here). */
  onOutcome?: (name: string, outcome: ToolExecutionResult) => void;
}

/**
 * Wraps registry definitions as Agents SDK function tools.
 * Invocations always call tools.execute (never a parallel code path).
 * The return type is inferred: the SDK's parameterized FunctionTool generics
 * differ per tool, and callers only pass the list to the Agent constructor.
 */
export function bindRegistryToolsForAgents(tools: ToolAccess, options: AgentToolBridgeOptions) {
  const priorToolNames: string[] = [];
  return tools.registry.listDefinitions().map((definition) =>
    agentTool<ArenaToolParameters>({
      name: definition.name,
      description: definition.description,
      parameters: toToolParameters(definition.jsonSchema),
      // Non-strict: validation belongs to tools.execute, as on every other
      // column, and vendor endpoints never receive a strict-mode schema.
      strict: false,
      execute: async (raw: unknown) => {
        const args = (raw ?? {}) as Record<string, unknown>;
        const blocked = blockedToolMessageContent(
          options.question,
          definition.name,
          args,
          priorToolNames,
          options.harness,
        );
        if (blocked !== null) return blocked;
        priorToolNames.push(definition.name);
        const outcome = await tools.execute(definition.name, normalizeToolCallArgs(definition, args), {
          signal: options.signal,
        });
        options.onOutcome?.(definition.name, outcome);
        return injectToolResultReminder(outcome.result, options.question);
      },
    }),
  );
}
