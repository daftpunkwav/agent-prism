/**
 * @file pipeline config schema test
 * @description Locks approval_mode retention through PipelineConfigSchema.
 *
 * Responsibilities:
 * - Pin the approval_mode default and boundary validation
 */

import { describe, expect, it } from "vitest";
import { BaselineOverridesSchema, PipelineConfigSchema } from "../src/index.js";

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
