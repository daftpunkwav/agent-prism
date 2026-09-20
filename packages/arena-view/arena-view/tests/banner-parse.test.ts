/**
 * @file banner-parse tests
 * @description Locks driver config banner parsing for chip/table rendering.
 */

import { describe, expect, it } from "vitest";
import { PIPELINE_BANNER_PREFIX } from "@agentprism/contracts";
import { parsePipelineBanner } from "../src/trace-events.js";

describe("parsePipelineBanner", () => {
  it("returns null for non-banner text", () => {
    expect(parsePipelineBanner("ordinary thought text")).toBeNull();
    expect(parsePipelineBanner(undefined)).toBeNull();
    expect(parsePipelineBanner("")).toBeNull();
  });

  it("splits native banners into framework, modes, and fields", () => {
    const parsed = parsePipelineBanner(
      `${PIPELINE_BANNER_PREFIX.native} reasoning=react · prompt=zero_shot · context=sliding · harness=bare`,
    );
    expect(parsed?.framework).toBe("Native Agent");
    expect(parsed?.modes).toEqual([]);
    expect(parsed?.fields?.slice(0, 3)).toMatchObject([
      { key: "reasoning", value: "react" },
      { key: "prompt", value: "zero_shot" },
      { key: "context", value: "sliding" },
    ]);
  });

  it("keeps mode labels and parenthetical value notes verbatim", () => {
    const parsed = parsePipelineBanner(
      `${PIPELINE_BANNER_PREFIX.langgraph} ReAct loop · zero_shot · context=sliding(real trim) · temp=0.7`,
    );
    expect(parsed?.framework).toBe("LangGraph");
    expect(parsed?.modes).toEqual(["ReAct loop", "zero_shot"]);
    expect(parsed?.fields).toMatchObject([
      { key: "context", value: "sliding(real trim)" },
      { key: "temp", value: "0.7" },
    ]);
  });
});
