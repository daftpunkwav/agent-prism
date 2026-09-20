/**
 * @file policy-dimensions test
 * @description Locks the new mcp/skill/orchestration comparison dimensions.
 */
import { describe, expect, it } from "vitest";
import { DIMENSION_FIELD } from "@agentprism/contracts";
import { DimensionCatalog } from "../src/dimension-catalog.js";

describe("policy dimensions", () => {
  it("maps to dedicated pipeline fields with usable options and defaults", () => {
    expect(DIMENSION_FIELD.mcp).toBe("mcp_policy");
    expect(DIMENSION_FIELD.skill).toBe("skill_policy");
    expect(DIMENSION_FIELD.orchestration).toBe("orchestration");
    expect(DIMENSION_FIELD.memory).toBe("memory");
    const catalog = new DimensionCatalog();
    expect(catalog.dimensionOptions("mcp").map((o) => o.value)).toEqual(["off", "fs", "full"]);
    expect(catalog.dimensionOptions("skill").map((o) => o.value)).toEqual(["off", "on_demand", "preloaded"]);
    expect(catalog.dimensionOptions("orchestration").map((o) => o.value)).toEqual(["direct", "plan_first", "goal_first"]);
    expect(catalog.dimensionOptions("memory").map((o) => o.value)).toEqual(["none", "episodic", "semantic", "full"]);
    expect(catalog.defaultBaseValue("mcp_policy")).toBe("off");
    expect(catalog.defaultBaseValue("skill_policy")).toBe("on_demand");
    expect(catalog.defaultBaseValue("orchestration")).toBe("direct");
    expect(catalog.defaultBaseValue("memory")).toBe("none");
    expect(catalog.isLegalFieldValue("mcp_policy", "full")).toBe(true);
    expect(catalog.isLegalFieldValue("memory", "episodic")).toBe(true);
    expect(catalog.isLegalFieldValue("memory", "yolo")).toBe(false);
    expect(catalog.isKnownField("orchestration")).toBe(true);
  });

  it("registers approval_mode as a baseline-only control field", () => {
    const catalog = new DimensionCatalog();
    expect(catalog.isKnownField("approval_mode")).toBe(true);
    expect(catalog.isLegalFieldValue("approval_mode", "auto")).toBe(true);
    expect(catalog.isLegalFieldValue("approval_mode", "unless_trusted")).toBe(true);
    expect(catalog.isLegalFieldValue("approval_mode", "yolo")).toBe(false);
    expect(catalog.defaultBaseValue("approval_mode")).toBe("auto");
  });

  it("accepts any in-range number for temperature/top_p (numeric baseline inputs)", () => {
    const catalog = new DimensionCatalog();
    expect(catalog.isLegalFieldValue("temperature", "0.35")).toBe(true);
    expect(catalog.isLegalFieldValue("temperature", "0")).toBe(true);
    expect(catalog.isLegalFieldValue("temperature", "2")).toBe(true);
    expect(catalog.isLegalFieldValue("temperature", "2.5")).toBe(false);
    expect(catalog.isLegalFieldValue("temperature", "")).toBe(false);
    expect(catalog.isLegalFieldValue("temperature", "abc")).toBe(false);
    expect(catalog.isLegalFieldValue("top_p", "0.85")).toBe(true);
    expect(catalog.isLegalFieldValue("top_p", "1")).toBe(true);
    expect(catalog.isLegalFieldValue("top_p", "1.5")).toBe(false);
    expect(catalog.isLegalFieldValue("top_p", "-0.1")).toBe(false);
  });

  it("accepts any in-range number for penalties (numeric baseline inputs)", () => {
    const catalog = new DimensionCatalog();
    expect(catalog.isLegalFieldValue("frequency_penalty", "0.7")).toBe(true);
    expect(catalog.isLegalFieldValue("frequency_penalty", "-1.5")).toBe(true);
    expect(catalog.isLegalFieldValue("frequency_penalty", "2.1")).toBe(false);
    expect(catalog.isLegalFieldValue("presence_penalty", "-2")).toBe(true);
    expect(catalog.isLegalFieldValue("presence_penalty", "2")).toBe(true);
    expect(catalog.isLegalFieldValue("presence_penalty", "3")).toBe(false);
  });

  it("accepts any in-range number for max_output_tokens (numeric baseline input)", () => {
    const catalog = new DimensionCatalog();
    expect(catalog.isLegalFieldValue("max_output_tokens", "96000")).toBe(true);
    expect(catalog.isLegalFieldValue("max_output_tokens", "99999")).toBe(true);
    expect(catalog.isLegalFieldValue("max_output_tokens", "64")).toBe(true);
    expect(catalog.isLegalFieldValue("max_output_tokens", "63")).toBe(false);
    expect(catalog.isLegalFieldValue("max_output_tokens", "128001")).toBe(true);
    expect(catalog.isLegalFieldValue("max_output_tokens", "384001")).toBe(false);
  });

  it("accepts in-range numbers plus the unlimited token for max_steps", () => {
    const catalog = new DimensionCatalog();
    expect(catalog.isLegalFieldValue("max_steps", "7")).toBe(true);
    expect(catalog.isLegalFieldValue("max_steps", "100000")).toBe(true);
    expect(catalog.isLegalFieldValue("max_steps", "100001")).toBe(false);
    expect(catalog.isLegalFieldValue("max_steps", "0")).toBe(false);
    expect(catalog.isLegalFieldValue("max_steps", "-2")).toBe(false);
    expect(catalog.isLegalFieldValue("max_steps", "-1")).toBe(true);
    expect(catalog.isLegalFieldValue("max_steps", "unlimited")).toBe(true);
    expect(catalog.isLegalFieldValue("max_steps", "abc")).toBe(false);
    expect(catalog.isLegalFieldValue("max_steps", "")).toBe(false);
  });

  it("registers sandbox_mode as a baseline-only control field", () => {
    const catalog = new DimensionCatalog();
    expect(catalog.isKnownField("sandbox_mode")).toBe(true);
    expect(catalog.isLegalFieldValue("sandbox_mode", "off")).toBe(true);
    expect(catalog.isLegalFieldValue("sandbox_mode", "os")).toBe(true);
    expect(catalog.isLegalFieldValue("sandbox_mode", "yolo")).toBe(false);
    expect(catalog.defaultBaseValue("sandbox_mode")).toBe("off");
  });
});
