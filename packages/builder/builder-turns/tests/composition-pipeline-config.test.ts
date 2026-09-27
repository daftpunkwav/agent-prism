/**
 * @file composition pipeline config tests
 * @description Locks toolset mapping and block carry-over into pipeline configs.
 */

import { describe, expect, it } from "vitest";
import { TOOL_NAMES_BY_TOOLSET, type BuilderComposition } from "@agentprism/contracts";
import { compositionToPipelineConfig, normalizeComposition } from "../src/composition.js";

const FULL = TOOL_NAMES_BY_TOOLSET.full;
const EDIT_RUN = TOOL_NAMES_BY_TOOLSET.edit_run;
const READ_ONLY = TOOL_NAMES_BY_TOOLSET.read_only;

function baseComposition(overrides: Partial<BuilderComposition> = {}): BuilderComposition {
  return { ...normalizeComposition({}), ...overrides };
}

describe("compositionToPipelineConfig", () => {
  it("maps exact toolset matches to their toolset id", () => {
    expect(compositionToPipelineConfig(baseComposition({ tools: [...FULL] }), "builder", { thinkingCapable: false }).toolset).toBe("full");
    expect(compositionToPipelineConfig(baseComposition({ tools: [...EDIT_RUN] }), "builder", { thinkingCapable: false }).toolset).toBe("edit_run");
    expect(compositionToPipelineConfig(baseComposition({ tools: [...READ_ONLY] }), "builder", { thinkingCapable: false }).toolset).toBe("read_only");
  });

  it("maps custom subsets and the empty set to the widest display base", () => {
    const custom = compositionToPipelineConfig(baseComposition({ tools: ["read", "grep"] }), "builder", { thinkingCapable: false });
    expect(custom.toolset).toBe("full");
    const none = compositionToPipelineConfig(baseComposition({ tools: [] }), "builder", { thinkingCapable: false });
    expect(none.toolset).toBe("full");
  });

  it("carries thinking capability and decode blocks", () => {
    const config = compositionToPipelineConfig(
      baseComposition({ thinking_level: "high", temperature: 0.3, max_output_tokens: 4096 }),
      "builder",
      { thinkingCapable: true },
    );
    expect(config.thinking_level).toBe("high");
    expect(config.thinking_capable).toBe(true);
    expect(config.temperature).toBe(0.3);
    expect(config.max_output_tokens).toBe(4096);
    expect(config.label).toBe("builder");
  });
});


describe("custom dimension defaults", () => {
  it("applies a registered dimension's declared default when the composition is unset", () => {
    // The palette highlights the declared default, so the run must use it: an
    // unset block that shows as selected while running as "nothing" would be a
    // silent no-op.
    const config = compositionToPipelineConfig(baseComposition(), "builder", {
      thinkingCapable: false,
      customDimensionDefaults: { summary_budget: "5000", tool_replay: "all" },
    });
    expect(config.custom).toEqual({ summary_budget: "5000", tool_replay: "all" });
  });

  it("keeps an explicit choice over the declared default", () => {
    const config = compositionToPipelineConfig(
      baseComposition({ custom: { summary_budget: "8000" } }),
      "builder",
      { thinkingCapable: false, customDimensionDefaults: { summary_budget: "5000", tool_replay: "all" } },
    );
    expect(config.custom).toEqual({ summary_budget: "8000", tool_replay: "all" });
  });

  it("carries the composition's values untouched when no defaults are supplied", () => {
    const config = compositionToPipelineConfig(
      baseComposition({ custom: { summary_budget: "2000" } }),
      "builder",
      { thinkingCapable: false },
    );
    expect(config.custom).toEqual({ summary_budget: "2000" });
    expect(compositionToPipelineConfig(baseComposition(), "builder", { thinkingCapable: false }).custom).toEqual({});
  });
});
