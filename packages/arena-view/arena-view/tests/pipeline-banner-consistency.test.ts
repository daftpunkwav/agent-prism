/**
 * @file pipeline banner tests
 * @description Locks the config banner contract.
 *
 * Responsibilities:
 * - Pin prefix format and foreign-banner detection
 */

import { describe, expect, it } from "vitest";
import {
  PIPELINE_BANNER_PREFIX,
  isForeignPipelineConfigBanner,
  isPipelineConfigBanner,
} from "@agentprism/contracts";
import { extractFinalAnswer } from "@agentprism/arena-view";
import type { ArenaEvent } from "@agentprism/contracts";

describe("config banner contract", () => {
  it("recognizes each driver's banner", () => {
    expect(isPipelineConfigBanner(`${PIPELINE_BANNER_PREFIX.langchain} Tool Calling · …`)).toBe(true);
    expect(isPipelineConfigBanner(`${PIPELINE_BANNER_PREFIX.langgraph} ReAct loop · …`)).toBe(true);
    expect(isPipelineConfigBanner(`${PIPELINE_BANNER_PREFIX.native} reasoning=react · …`)).toBe(true);
    expect(isPipelineConfigBanner("ordinary thought text")).toBe(false);
    expect(isPipelineConfigBanner(undefined)).toBe(false);
  });

  it("foreign banners are judged by frameworkId; own-column banners are not foreign", () => {
    const foreign = `${PIPELINE_BANNER_PREFIX.native} reasoning=react`;
    expect(isForeignPipelineConfigBanner(foreign, "langchain")).toBe(true);
    expect(isForeignPipelineConfigBanner(foreign, "native")).toBe(false);
    expect(isForeignPipelineConfigBanner("ordinary text", "langchain")).toBe(false);
    expect(isForeignPipelineConfigBanner(foreign, undefined)).toBe(false);
    expect(isForeignPipelineConfigBanner(foreign, "unknown")).toBe(false);
  });

  it("extractFinalAnswer filters foreign banners that drifted into this column (judge pollution regression)", () => {
    const foreignBanner = `${PIPELINE_BANNER_PREFIX.native} reasoning=react · prompt=zero_shot · …`;
    const events: ArenaEvent[] = [
      { type: "thought", pipeline: "LangChain column", turn: 1, content: foreignBanner, workspace: "", tool: "", args: {}, result: "", step: 0, passed: null, reason: "", message: "", metrics: null, token_stats: null, agentId: "a", runId: "r", timestamp: 0 },
      { type: "thought", pipeline: "LangChain column", turn: 1, content: "The final answer is 42", workspace: "", tool: "", args: {}, result: "", step: 1, passed: null, reason: "", message: "", metrics: null, token_stats: null, agentId: "a", runId: "r", timestamp: 1 },
    ];
    expect(extractFinalAnswer(events)).toBe("The final answer is 42");
    // Own-column banner is also excluded from the answer
    const first = events[0];
    const second = events[1];
    if (first === undefined || second === undefined) throw new Error("fixture error");
    const ownBannerEvents: ArenaEvent[] = [
      { ...first, content: `${PIPELINE_BANNER_PREFIX.langchain} Tool Calling · …` },
      second,
    ];
    expect(extractFinalAnswer(ownBannerEvents)).toBe("The final answer is 42");
  });
});
