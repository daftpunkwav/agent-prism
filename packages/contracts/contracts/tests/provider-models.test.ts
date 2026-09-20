/**
 * @file provider models tests
 * @description Locks provider model-list validation: 422-shaped issues, trims, dedupes.
 */

import { describe, expect, it } from "vitest";
import {
  ProviderConfigUpdateSchema,
} from "@agentprism/contracts";

describe("provider models validation (422-shaped issues, never uncaught throws)", () => {
  it("an overlong model id fails safeParse with an issue instead of throwing", () => {
    const parsed = ProviderConfigUpdateSchema.safeParse({ models: [`m${"x".repeat(200)}`] });
    // Regression: a raw throw inside .transform escaped even safeParse in zod 4 (HTTP 500).
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toMatch(/too long/);
    }
  });

  it("trims and dedupes model ids without failing", () => {
    const parsed = ProviderConfigUpdateSchema.safeParse({ models: [" b ", "b", "", "a"] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.models).toEqual(["b", "a"]);
  });
});

