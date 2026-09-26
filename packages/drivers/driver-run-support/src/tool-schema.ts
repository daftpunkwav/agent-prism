/**
 * @file tool-schema
 * @description JSON-Schema → zod derivation for tool binding, shared by every SDK backend.
 *
 * Responsibilities:
 * - Derive zod schemas / raw shapes from a registry tool's own JSON Schema
 * - Normalize ask_user args before validation and execution
 *
 * Every backend needs the same projection of a registry ToolDefinition into its
 * vendor's tool shape (LangChain StructuredTool, OpenAI Agents FunctionTool, MCP
 * raw shape). Keeping the derivation here keeps one source; backends only differ
 * in how they wrap the result.
 */

import type { ToolDefinition } from "@agentprism/contracts";
import { lowerAskUserKeys, normalizeAskUserBatchArgs, normalizeAskUserOptions } from "@agentprism/contracts";
import { z } from "zod";

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

/** Declared top-level property names of an object schema (empty when it declares none). */
function declaredPropertyNames(jsonSchema: unknown): string[] {
  if (jsonSchema === null || typeof jsonSchema !== "object" || Array.isArray(jsonSchema)) return [];
  const root = jsonSchema as Record<string, unknown>;
  if (root.type !== "object") return [];
  const properties = root.properties;
  if (properties === null || typeof properties !== "object" || Array.isArray(properties)) return [];
  return Object.keys(properties);
}

/**
 * Derives the zod raw shape for a tool's JSON Schema (single source): objects map
 * field-by-field with required-ness preserved at every level. Exotic shapes fall
 * back to the declared parameter names typed `unknown`, so a third-party
 * registration still binds with callable arguments instead of failing to load.
 */
export function deriveToolZodRawShape(definition: ToolDefinition): Record<string, z.ZodType> {
  const root = definition.jsonSchema;
  if (root.type !== "object") return {};
  const shape = jsonSchemaToZodShape(root);
  if (shape !== null) return shape;
  return Object.fromEntries(declaredPropertyNames(root).map((name) => [name, z.unknown()]));
}

/**
 * Converts an object JSON Schema to a zod raw shape; null when any field is exotic.
 * Raw shapes are what MCP-style tool factories take verbatim.
 */
export function jsonSchemaToZodShape(jsonSchema: unknown): Record<string, z.ZodType> | null {
  if (jsonSchema === null || typeof jsonSchema !== "object" || Array.isArray(jsonSchema)) return null;
  const root = jsonSchema as Record<string, unknown>;
  if (root.type !== "object") return null;
  const properties = root.properties;
  if (properties === null || typeof properties !== "object" || Array.isArray(properties)) return null;
  const required = new Set(
    Array.isArray(root.required) ? root.required.filter((key): key is string => typeof key === "string") : [],
  );
  const shape: Record<string, z.ZodType> = {};
  for (const [name, sub] of Object.entries(properties)) {
    if (sub === null || typeof sub !== "object" || Array.isArray(sub)) return null;
    const inner = valueSchema(sub as Record<string, unknown>);
    if (inner === null) return null;
    shape[name] = required.has(name) ? inner : inner.optional();
  }
  return shape;
}

/**
 * Derives the object-schema view of a tool (LC/OpenAI Agents style). Only exotic
 * shapes fall back to an open record.
 */
export function deriveToolZodObject(definition: ToolDefinition): z.ZodType {
  const root = definition.jsonSchema;
  if (root.type !== "object") return z.record(z.string(), z.unknown());
  const shape = jsonSchemaToZodShape(root);
  const base = shape === null ? z.record(z.string(), z.unknown()) : z.object(shape);
  // ask_user tolerance: models occasionally send QUESTIONS/ID/HEADER/QUESTION/OPTIONS
  // uppercased (observed in Arena columns). Preprocessing lowercases those keys before
  // zod validation so the call reaches tools.execute (which normalizes again) instead
  // of failing validation with no human window popping (the "stuck" run).
  if (definition.name === "ask_user") {
    return z.preprocess((value) => normalizeToolCallArgs(definition, value as Record<string, unknown>), base);
  }
  return base;
}

/**
 * Normalizes call args before validation and again before execute: lowercases
 * ask_user batch keys and coerces options to a flat string array, so a
 * double-wrapped `options: [["A","B"]]` (the observed "expected string, received
 * array at questions[0].options[0]") validates instead of failing the call.
 * Every other tool passes through untouched.
 */
export function normalizeToolCallArgs(
  definition: ToolDefinition,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (definition.name !== "ask_user") return args;
  if (args === null || typeof args !== "object" || Array.isArray(args)) return args;
  const batch = normalizeAskUserBatchArgs(args);
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
