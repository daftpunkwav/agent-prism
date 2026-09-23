/**
 * @file builder default composition tests
 * @description Locks the factory-default composition helper: schema defaults,
 *              shared by the UI restore-default action and server normalization.
 */

import { describe, expect, it } from "vitest";
import { BuilderCompositionSchema, defaultBuilderComposition } from "../src/builder.js";

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
