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
import { z } from "zod";
import type { ToolDefinition, ToolExecutionResult } from "@agentprism/contracts";
import { lowerAskUserKeys, normalizeAskUserBatchArgs, normalizeAskUserOptions } from "@agentprism/contracts";
import type { ToolAccess } from "@agentprism/harness";

/** Attaches the model-facing description when present. */
function described(base: z.ZodType, property: Record<string, unknown>): z.ZodType {
  const description = property.description;
  return typeof description === "string" && description !== "" ? base.describe(description) : base;
}

/**
 * Maps one JSON-Schema value to zod, recursing into arrays and nested objects
 * (todo_write/ask_user lists need them); null when the shape is exotic.
 */
function valueSchema(property: Record<string, unknown>): z.ZodType | null {
  if (property.type === "string") return described(z.string(), property);
  if (property.type === "integer") return described(z.number().int(), property);
  if (property.type === "number") return described(z.number(), property);
  if (property.type === "boolean") return described(z.boolean(), property);
  if (property.type === "array") {
    const items = property.items;
    if (items === null || typeof items !== "object" || Array.isArray(items)) return null;
    const inner = valueSchema(items as Record<string, unknown>);
    if (inner === null) return null;
    return described(z.array(inner), property);
  }
  if (property.type === "object") {
    const properties = property.properties;
    if (properties === null || typeof properties !== "object" || Array.isArray(properties)) return null;
    const required = new Set(
      Array.isArray(property.required) ? property.required.filter((key): key is string => typeof key === "string") : [],
    );
    const shape: Record<string, z.ZodType> = {};
    for (const [name, sub] of Object.entries(properties)) {
      if (sub === null || typeof sub !== "object" || Array.isArray(sub)) return null;
      const inner = valueSchema(sub as Record<string, unknown>);
      if (inner === null) return null;
      shape[name] = required.has(name) ? inner : inner.optional();
    }
    return described(z.object(shape), property);
  }
  return null;
}

/**
 * Derives the LangChain zod schema from the tool's own JSON schema (single source):
 * objects map field-by-field with required-ness preserved at every level, arrays map
 * to z.array (LC requires Zod, not raw JSON Schema). Only exotic shapes fall back to
 * an open record so third-party registrations still bind instead of failing to load.
 */
function schemaFor(definition: ToolDefinition): z.ZodType {
  const fallback = z.record(z.string(), z.unknown());
  const root = definition.jsonSchema;
  if (root.type !== "object") return fallback;
  const derived = valueSchema(root as Record<string, unknown>);
  const base = derived ?? fallback;
  // ask_user tolerance: models occasionally send QUESTIONS/ID/HEADER/QUESTION/OPTIONS
  // uppercased (observed in Arena columns). Preprocessing lowercases those keys before
  // zod validation so the call reaches tools.execute (which normalizes again) instead
  // of failing validation with no human window popping (the "stuck" run).
  if (definition.name === "ask_user") {
    return z.preprocess(normalizeAskUserArgs, base);
  }
  return base;
}

/**
 * Normalizes ask_user args before zod validation (and again before execute):
 * lowercases batch keys and coerces options to a flat string array, so a
 * double-wrapped `options: [["A","B"]]` (the observed "expected string, received
 * array at questions[0].options[0]") validates instead of failing the call.
 */
function normalizeAskUserArgs(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const batch = normalizeAskUserBatchArgs(value as Record<string, unknown>);
  if (Array.isArray(batch.questions)) {
    batch.questions = (batch.questions as unknown[]).map((item) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
      const out = lowerAskUserKeys(item as Record<string, unknown>);
      if (out.options !== undefined) out.options = normalizeAskUserOptions(out.options);
      return out;
    });
  }
  return batch;
}

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
    const schema = schemaFor(definition);
    bound.push(
      tool(
        async (args: Record<string, unknown>) => {
          const effective =
            definition.name === "ask_user"
              ? (normalizeAskUserArgs(args) as Record<string, unknown>)
              : args;
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
