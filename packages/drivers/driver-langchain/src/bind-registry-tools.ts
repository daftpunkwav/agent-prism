/**
 * @file bind-registry-tools
 * @description Adapts column ToolAccess into LangChain StructuredTools.
 *
 * Responsibilities:
 * - Route every invoke through tools.execute
 *
 * Keeps RAG invalidation, authorization, and fileDiff side channels on the
 * shared guarded path.
 */

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { sanitizeErrorMessage, type ToolExecutionResult } from "@agentprism/contracts";
import type { ToolAccess } from "@agentprism/harness";
import { deriveToolZodObject, normalizeToolCallArgs } from "@agentprism/driver-run-support";

/**
 * The subset binding actually consumes: a definition source plus the shared execute
 * entry. Declared narrowly so callers that filter definitions (e.g. Deep Agents'
 * reserved-name handling) do not have to pretend their view is a full ToolAccess.
 */
export type BindableToolAccess = Pick<ToolAccess, "execute"> & {
  registry: Pick<ToolAccess["registry"], "listDefinitions">;
};

export interface BindRegistryToolsOptions {
  signal?: AbortSignal;
  /**
   * Extra Arena events (file_diff / tool_progress) after every execute that produced
   * an outcome; a throwing tool yields error text instead and reports nothing (the
   * registry contract keeps handler failures out of the outcome channel).
   */
  onOutcome?: (name: string, outcome: ToolExecutionResult) => void;
}

/**
 * Wraps registry definitions as LangChain StructuredTools.
 * Invocations always call tools.execute (never a parallel code path).
 *
 * tool-registry's contract (registry.ts) leaves handler failures to the driver
 * "which converges them": abort rethrows, any other error becomes error text the
 * model can recover from. Without this catch a failing tool would instead abort the
 * whole column, which would make the same fault show up differently per backend.
 */
export function bindRegistryTools(
  tools: BindableToolAccess,
  options?: BindRegistryToolsOptions,
): StructuredToolInterface[] {
  const bound: StructuredToolInterface[] = [];
  for (const definition of tools.registry.listDefinitions()) {
    const schema = deriveToolZodObject(definition);
    bound.push(
      tool(
        async (args: Record<string, unknown>) => {
          const effective = normalizeToolCallArgs(definition, args);
          let outcome: ToolExecutionResult;
          try {
            outcome = await tools.execute(definition.name, effective, { signal: options?.signal });
          } catch (error) {
            if ((error as Error)?.name === "AbortError") throw error;
            return `Error: tool ${definition.name} failed: ${sanitizeErrorMessage(error)}`;
          }
          options?.onOutcome?.(definition.name, outcome);
          return outcome.result;
        },
        {
          name: definition.name,
          description: definition.description,
          schema,
        },
      ),
    );
  }
  return bound;
}
