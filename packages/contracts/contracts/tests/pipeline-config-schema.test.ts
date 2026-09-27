/**
 * @file pipeline config schema test
 * @description Locks approval_mode / sandbox_mode retention and the context
 * strategy wire boundary through PipelineConfigSchema.
 *
 * Responsibilities:
 * - Pin the approval_mode and sandbox_mode defaults and boundary validation
 * - Pin that pinned configs (threads, builder compositions) take builtin
 *   strategies only, while baseline overrides stay dynamic (the router validates
 *   them against the live option set, not the schema)
 */

import { describe, expect, it } from "vitest";
import { BaselineOverridesSchema, ContextStrategySchema, PipelineConfigSchema } from "../src/index.js";

describe("PipelineConfigSchema approval_mode", () => {
  it("defaults to auto", () => {
    expect(PipelineConfigSchema.parse({}).approval_mode).toBe("auto");
  });

  it("accepts unless_trusted", () => {
    expect(PipelineConfigSchema.parse({ approval_mode: "unless_trusted" }).approval_mode).toBe("unless_trusted");
  });

  it("rejects unknown values at the boundary (fail-closed)", () => {
    expect(PipelineConfigSchema.safeParse({ approval_mode: "yolo" }).success).toBe(false);
  });

  it("carries approval_mode through baseline overrides", () => {
    const parsed = BaselineOverridesSchema.parse({ approval_mode: "unless_trusted" });
    expect(parsed.approval_mode).toBe("unless_trusted");
  });
});

describe("PipelineConfigSchema sandbox_mode", () => {
  it("defaults to off", () => {
    expect(PipelineConfigSchema.parse({}).sandbox_mode).toBe("off");
  });

  it("accepts os", () => {
    expect(PipelineConfigSchema.parse({ sandbox_mode: "os" }).sandbox_mode).toBe("os");
  });

  it("rejects unknown values at the boundary (fail-closed)", () => {
    expect(PipelineConfigSchema.safeParse({ sandbox_mode: "yolo" }).success).toBe(false);
  });

  it("carries sandbox_mode through baseline overrides", () => {
    const parsed = BaselineOverridesSchema.parse({ sandbox_mode: "os" });
    expect(parsed.sandbox_mode).toBe("os");
  });
});

describe("PipelineConfigSchema context", () => {
  it("accepts every builtin strategy", () => {
    for (const id of ContextStrategySchema.options) {
      expect(PipelineConfigSchema.parse({ context: id }).context).toBe(id);
    }
  });

  it("rejects non-builtin context ids on pinned configs (threads, builder compositions)", () => {
    // The Arena path resolves context ids through the synced option set; a config
    // pinned as a whole still enumerates the builtins, so a value outside that set
    // cannot be pinned there.
    expect(PipelineConfigSchema.safeParse({ context: "unknown_strategy" }).success).toBe(false);
  });

  it("keeps the baseline context field dynamic (validated one layer down)", () => {
    expect(BaselineOverridesSchema.parse({ context: "unknown_strategy" }).context).toBe("unknown_strategy");
  });
});
