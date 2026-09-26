/**
 * @file tool-schema tests
 * @description Locks the shared JSON-Schema → zod derivation.
 *
 * Responsibilities:
 * - Cover scalar/array/nested-object derivation with required-ness
 * - Cover the exotic-shape fallbacks (raw shape keeps declared names; object view stays open)
 * - Cover ask_user argument normalization
 */

import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@agentprism/contracts";
import {
  deriveToolZodObject,
  deriveToolZodRawShape,
  jsonSchemaToZodShape,
  normalizeToolCallArgs,
} from "../src/tool-schema.js";

/** Minimal registry definition around a JSON Schema (execute is never called here). */
function definition(name: string, jsonSchema: Record<string, unknown>): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    jsonSchema,
    mutatesWorkspace: false,
    execute: async () => ({ result: "", fileDiff: null, ok: true }),
  };
}

describe("deriveToolZodRawShape", () => {
  it("maps scalar fields and preserves required-ness at the top level", () => {
    const shape = deriveToolZodRawShape(
      definition("read_file", {
        type: "object",
        properties: { path: { type: "string", description: "file to read" }, limit: { type: "integer" } },
        required: ["path"],
      }),
    );
    expect(Object.keys(shape).sort()).toEqual(["limit", "path"]);
    expect(shape["path"]?.isOptional()).toBe(false);
    expect(shape["limit"]?.isOptional()).toBe(true);
    expect(shape["path"]?.safeParse("a.txt").success).toBe(true);
    expect(shape["limit"]?.safeParse(2.5).success).toBe(false);
  });

  it("recurses into arrays and nested objects", () => {
    const shape = deriveToolZodRawShape(
      definition("todo_write", {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: { content: { type: "string" }, done: { type: "boolean" } },
              required: ["content"],
            },
          },
        },
        required: ["todos"],
      }),
    );
    const parsed = shape["todos"]?.safeParse([{ content: "x", done: true }]);
    expect(parsed?.success).toBe(true);
    expect(shape["todos"]?.safeParse([{ done: true }]).success).toBe(false);
  });

  it("keeps declared parameter names when a field shape is exotic", () => {
    const shape = deriveToolZodRawShape(
      definition("odd", {
        type: "object",
        properties: { payload: { oneOf: [{ type: "string" }, { type: "number" }] }, plain: { type: "string" } },
        required: ["payload"],
      }),
    );
    expect(Object.keys(shape).sort()).toEqual(["payload", "plain"]);
    // Fallback typing accepts anything, so the call still binds and reaches tools.execute.
    expect(shape["payload"]?.safeParse({ whatever: 1 }).success).toBe(true);
  });

  it("returns an empty shape for a non-object schema", () => {
    expect(deriveToolZodRawShape(definition("odd", { type: "string" }))).toEqual({});
    expect(deriveToolZodRawShape(definition("odd", { type: "object", properties: { a: { type: "string" } } }))).toHaveProperty("a");
  });
});

describe("jsonSchemaToZodShape", () => {
  it("returns null when the root is not an object schema", () => {
    expect(jsonSchemaToZodShape({ type: "array" })).toBeNull();
    expect(jsonSchemaToZodShape(null)).toBeNull();
    expect(jsonSchemaToZodShape("nope")).toBeNull();
  });
});

describe("deriveToolZodObject", () => {
  it("validates a well-formed call", () => {
    const schema = deriveToolZodObject(
      definition("grep", { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] }),
    );
    expect(schema.safeParse({ pattern: "x" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("stays open for exotic schemas so third-party registrations still bind", () => {
    const schema = deriveToolZodObject(definition("odd", { type: "object", properties: { a: { oneOf: [] } } }));
    expect(schema.safeParse({ anything: 1 }).success).toBe(true);
  });

  it("preprocesses ask_user args so uppercased keys and nested options still validate", () => {
    const schema = deriveToolZodObject(
      definition("ask_user", {
        type: "object",
        properties: {
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } } },
              required: ["question"],
            },
          },
        },
        required: ["questions"],
      }),
    );
    const result = schema.safeParse({ QUESTIONS: [{ QUESTION: "pick", OPTIONS: [["A", "B"]] }] });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ questions: [{ question: "pick", options: ["A", "B"] }] });
  });
});

describe("normalizeToolCallArgs", () => {
  it("passes non-ask_user tools through untouched", () => {
    const args = { path: "a.txt" };
    expect(normalizeToolCallArgs(definition("read_file", { type: "object" }), args)).toBe(args);
  });

  it("normalizes ask_user keys and options in place", () => {
    const args = { QUESTIONS: [{ ID: "q1", HEADER: "h", QUESTION: "pick", OPTIONS: [["A", "B"]] }] };
    expect(normalizeToolCallArgs(definition("ask_user", { type: "object" }), args)).toEqual({
      questions: [{ id: "q1", header: "h", question: "pick", options: ["A", "B"] }],
    });
  });
});
