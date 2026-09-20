/**
 * @file MatrixRequestSchema tests
 * @description Locks the matrix request wire limits.
 *
 * Responsibilities:
 * - Pin the full-matrix cell budget (must cover the scored template set)
 */

import { describe, expect, it } from "vitest";
import { MatrixRequestSchema } from "@agentprism/contracts";

describe("MatrixRequestSchema cells budget", () => {
  it("accepts the full scored template set (15 cells today)", () => {
    const cells = Array.from({ length: 15 }, (_, i) => ({ template_id: `t${i + 1}` }));
    const parsed = MatrixRequestSchema.safeParse({ cells });
    expect(parsed.success).toBe(true);
  });

  it("rejects more than 32 cells", () => {
    const cells = Array.from({ length: 33 }, (_, i) => ({ template_id: `t${i + 1}` }));
    expect(MatrixRequestSchema.safeParse({ cells }).success).toBe(false);
  });

  it("rejects an empty cell list", () => {
    expect(MatrixRequestSchema.safeParse({ cells: [] }).success).toBe(false);
  });
});
