/**
 * @file builder default composition tests
 * @description Locks the factory-default composition helper: schema defaults,
 *              shared by the UI restore-default action and server normalization.
 */

import { describe, expect, it } from "vitest";
import { BuilderCompositionSchema, apiFormatSatisfies, defaultBuilderComposition, requiredApiFormat } from "../src/builder.js";

describe("defaultBuilderComposition", () => {
  it("returns the schema's own defaults", () => {
    expect(defaultBuilderComposition()).toEqual(BuilderCompositionSchema.parse({}));
  });

  it("produces an independent object each call", () => {
    const first = defaultBuilderComposition();
    const second = defaultBuilderComposition();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.tools).not.toBe(second.tools);
  });

  it("seeds the documented out-of-the-box blocks", () => {
    const composition = defaultBuilderComposition();
    expect(composition.framework).toBe("native");
    expect(composition.reasoning).toBe("react");
    expect(composition.tools).toContain("read");
    expect(composition.max_output_tokens).toBeGreaterThan(0);
  });
});

describe("requiredApiFormat", () => {
  it("names the one protocol a constrained framework speaks, and nothing for the rest", () => {
    expect(requiredApiFormat("claude_agent_sdk")).toBe("anthropic_messages");
    expect(requiredApiFormat("native")).toBe("");
    expect(apiFormatSatisfies("", undefined)).toBe(true);
    expect(apiFormatSatisfies("anthropic_messages", "anthropic_messages")).toBe(true);
    expect(apiFormatSatisfies("anthropic_messages", "openai_chat")).toBe(false);
    expect(apiFormatSatisfies("anthropic_messages", undefined)).toBe(false);
  });
});
