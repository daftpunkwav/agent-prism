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
import { BaselineOverridesSchema, ContextStrategySchema, DECODE_FIELD_RANGES, PipelineConfigSchema } from "../src/index.js";

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

describe("PipelineConfigSchema decode ranges", () => {
  it("accepts the full shared DECODE_FIELD_RANGES bounds (baseline-pinnable values)", () => {
    const ranges = DECODE_FIELD_RANGES;
    expect(
      PipelineConfigSchema.safeParse({
        temperature: ranges.temperature.max,
        top_p: ranges.top_p.min,
        frequency_penalty: ranges.frequency_penalty.min,
        presence_penalty: ranges.presence_penalty.max,
        // Regression: the schema used to stop at 128k while the baseline number
        // input offers up to this bound, so a pinnable value failed pinned configs.
        max_output_tokens: ranges.max_output_tokens.max,
      }).success,
    ).toBe(true);
  });

  it("rejects values outside the shared ranges (fail-closed pinned config)", () => {
    expect(PipelineConfigSchema.safeParse({ max_output_tokens: DECODE_FIELD_RANGES.max_output_tokens.max + 1 }).success).toBe(false);
    expect(PipelineConfigSchema.safeParse({ max_output_tokens: DECODE_FIELD_RANGES.max_output_tokens.min - 1 }).success).toBe(false);
    expect(PipelineConfigSchema.safeParse({ temperature: DECODE_FIELD_RANGES.temperature.max + 1 }).success).toBe(false);
    expect(PipelineConfigSchema.safeParse({ top_p: DECODE_FIELD_RANGES.top_p.max + 1 }).success).toBe(false);
    expect(PipelineConfigSchema.safeParse({ frequency_penalty: DECODE_FIELD_RANGES.frequency_penalty.min - 1 }).success).toBe(false);
    expect(PipelineConfigSchema.safeParse({ presence_penalty: DECODE_FIELD_RANGES.presence_penalty.max + 1 }).success).toBe(false);
  });
});
