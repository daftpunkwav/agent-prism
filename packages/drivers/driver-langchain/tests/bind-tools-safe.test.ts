/**
 * @file bind-tools-safe tests
 * @description Covers the optional bindTools capability guard.
 *
 * Responsibilities:
 * - Pin that models with bindTools get the tools bound through
 * - Pin the fail-loud error for models without tool support
 */

import { describe, expect, it } from "vitest";
import { bindToolsSafe } from "../src/bind-tools-safe.js";

describe("bindToolsSafe", () => {
  it("delegates to bindTools when the model supports it", () => {
    const bound = { bound: true };
    const model = {
      bindTools: (tools: unknown[]) => ({ toolset: bound, count: tools.length }),
    };
    const result = bindToolsSafe(model as never, [{ name: "t" } as never]);
    expect(result).toEqual({ toolset: { bound: true }, count: 1 });
  });

  it("throws loudly when the model cannot bind tools", () => {
    expect(() => bindToolsSafe({} as never, [])).toThrow(/does not support tool binding/);
  });
});
