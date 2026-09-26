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
import type { ToolExecutionResult } from "@agentprism/contracts";
import type { ToolAccess } from "@agentprism/harness";
import { deriveToolZodObject, normalizeToolCallArgs } from "@agentprism/driver-run-support";

export interface BindRegistryToolsOptions {
  signal?: AbortSignal;
  /** Extra Arena events (file_diff / tool_progress) after every execute (success or error-text). */
  onOutcome?: (name: string, outcome: ToolExecutionResult) => void;
}

/**
 * Wraps registry definitions as LangChain StructuredTools.
 * Invocations always call tools.execute (never a parallel code path).
 */
export function bindRegistryTools(
  tools: ToolAccess,
  options?: BindRegistryToolsOptions,
): StructuredToolInterface[] {
  const bound: StructuredToolInterface[] = [];
  for (const definition of tools.registry.listDefinitions()) {
    const schema = deriveToolZodObject(definition);
    bound.push(
      tool(
        async (args: Record<string, unknown>) => {
          const effective = normalizeToolCallArgs(definition, args);
          const outcome = await tools.execute(definition.name, effective, { signal: options?.signal });
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
