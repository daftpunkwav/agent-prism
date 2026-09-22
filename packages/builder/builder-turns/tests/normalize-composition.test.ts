/**
 * @file normalize-composition tests
 * @description Locks composition defaults, dedupe, and range rejection.
 */

import { describe, expect, it } from "vitest";
import { normalizeComposition } from "../src/composition.js";
import { BuilderError } from "../src/errors.js";

describe("normalizeComposition", () => {
  it("fills defaults and dedupes tools preserving order", () => {
    const composition = normalizeComposition({ tools: ["read", "write", "read"] });
    expect(composition.framework).toBe("native");
    expect(composition.tools).toEqual(["read", "write"]);
    expect(composition.max_steps).toBe(200);
    expect(composition.max_output_tokens).toBe(64_000);
  });

  it("migrates the pre-rename run tool name to bash on parse", () => {
    const composition = normalizeComposition({ tools: ["run", "read", "run"] });
    expect(composition.tools).toEqual(["bash", "read"]);
  });

  it("rejects out-of-range values", () => {
    expect(() => normalizeComposition({ max_steps: 0 })).toThrow(BuilderError);
    expect(() => normalizeComposition({ temperature: 5 })).toThrow(BuilderError);
  });
});

