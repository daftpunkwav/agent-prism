/**
 * @file bind-registry-tools tests
 * @description Locks LC zod derivation against the tools single source.
 *
 * Responsibilities:
 * - Pin every builtin tool's required JSON fields present in its bound schema
 */

import { describe, expect, it } from "vitest";
import { createBuiltinToolRegistry } from "@agentprism/tool-builtins";
import { bindRegistryTools } from "../src/bind-registry-tools.js";

function shapeKeys(schema: unknown): string[] | null {
  // Unwrap z.preprocess (zod v4 ZodPipe with in/out, zod v3 ZodEffects with innerType)
  // used for case-tolerant tools like ask_user.
  let current = schema as Record<string, unknown> | null;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    const shape = (current as { shape?: unknown }).shape;
    if (shape !== null && shape !== undefined && typeof shape === "object" && !Array.isArray(shape)) {
      return Object.keys(shape as Record<string, unknown>);
    }
    // zod v4 pipe: { in, out } or { def: { out } }
    const out =
      (current as { out?: unknown }).out ??
      (current as { def?: { out?: unknown } }).def?.out ??
      (current as { innerType?: unknown }).innerType ??
      (current as { def?: { innerType?: unknown } }).def?.innerType;
    if (out === null || out === undefined || typeof out !== "object") return null;
    current = out as Record<string, unknown>;
  }
  return null;
}

describe("bindRegistryTools schema derivation", () => {
  it("every builtin tool exposes its required JSON fields to the model", () => {
    const registry = createBuiltinToolRegistry();
    const bound = bindRegistryTools({
      registry,
      names: new Set(registry.listDefinitions().map((definition) => definition.name)),
      execute: async () => ({ result: "", fileDiff: null, ok: true }),
    });
    expect(bound.length).toBeGreaterThan(0);
    for (const definition of registry.listDefinitions()) {
      const tool = bound.find((item) => item.name === definition.name);
      expect(tool, `tool ${definition.name} not bound`).toBeDefined();
      const required = (definition.jsonSchema.required as string[] | undefined) ?? [];
      const keys = shapeKeys(tool?.schema);
      // Derivation must stay total: a fallback record has no shape, leaving required
      // fields without model hints (the drift this test guards against).
      expect(keys, `tool ${definition.name} fell back to an open record`).not.toBeNull();
      for (const key of required) {
        expect(keys, `tool ${definition.name} missing required field ${key}`).toContain(key);
      }
    }
  });

  it("ask_user accepts an input-wrapped stringified batch (observed LangChain shape)", async () => {
    const registry = createBuiltinToolRegistry();
    let seen: Record<string, unknown> | null = null;
    const bound = bindRegistryTools({
      registry,
      names: new Set(["ask_user"]),
      execute: async (_name, args) => {
        seen = { args };
        return { result: "ok", fileDiff: null, ok: true };
      },
    });
    const ask = bound.find((item) => item.name === "ask_user");
    expect(ask).toBeDefined();
    const inner = JSON.stringify({ questions: [{ id: "test1", question: "可用?", options: ["行", "不行"] }] });
    const out = await (ask as unknown as { invoke: (a: unknown) => Promise<unknown> }).invoke({ input: inner });
    expect(out).toBe("ok");
    const args = (seen as unknown as { args: { questions: Array<{ id: string; options: string[] }> } }).args;
    expect(args.questions).toEqual([{ id: "test1", question: "可用?", options: ["行", "不行"] }]);
  });

  it("ask_user accepts double-wrapped options (regression: options[0]-array)", async () => {
    const registry = createBuiltinToolRegistry();
    let seen: Record<string, unknown> | null = null;
    const bound = bindRegistryTools({
      registry,
      names: new Set(["ask_user"]),
      execute: async (_name, args) => {
        seen = { args };
        return { result: "ok", fileDiff: null, ok: true };
      },
    });
    const ask = bound.find((item) => item.name === "ask_user");
    expect(ask).toBeDefined();
    const out = await (ask as unknown as { invoke: (a: unknown) => Promise<unknown> }).invoke({
      questions: [{ id: "t", question: "可用?", options: [["可用", "不可用"]] }],
    });
    expect(out).toBe("ok");
    expect(seen).not.toBeNull();
    const args = (seen as unknown as { args: { questions: Array<{ options: string[] }> } }).args;
    expect(args.questions[0]?.options).toEqual(["可用", "不可用"]);
  });
});
