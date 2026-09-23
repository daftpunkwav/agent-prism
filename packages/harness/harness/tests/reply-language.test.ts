/**
 * @file reply language directive tests
 * @description Locks the reply-language pin in prompt assembly.
 *
 * Responsibilities:
 * - Pin the Chinese directive on the system prompt (zh-CN / zh)
 * - Pin absence for English/unknown locales and the empty-directive contract
 * - Pin directive survival across systemPromptOverride
 */

import { describe, expect, it } from "vitest";
import { agentReplyDirective, isChineseLocale } from "@agentprism/contracts";
import { buildSystemUser, type AgentExecutionContext } from "../src/index.js";

function context(language: string | undefined, override = ""): AgentExecutionContext {
  return {
    identity: { agentId: "a1", runId: "r1" },
    config: {
      framework: "native",
      reasoning: "react",
      context: "sliding",
      harness: "bare",
      prompt_profile: "zero_shot",
      endpoint_id: "",
      model_id: "m",
      temperature: 0,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      max_output_tokens: 96_000,
      thinking_level: "off",
      thinking_capable: false,
      max_steps: 5,
      toolset: "read_only",
      mcp_policy: "off",
      skill_policy: "off",
      approval_mode: "auto",
      sandbox_mode: "off",
      orchestration: "direct",
      memory: "none",
      history_mode: "minimal",
      prompt_version: "v1.0.0",
      label: "col",
    },
    question: "你好",
    history: [],
    ...(language === undefined ? {} : { language }),
    turn: 1,
    workspace: { name: "ws", cwd: () => "D:\\ws", fs: {} } as unknown as AgentExecutionContext["workspace"],
    tracker: {
      seedPrompt: () => undefined,
      asDict: () => ({}),
    } as unknown as AgentExecutionContext["tracker"],
    clock: { now: () => 1_000 },
    rag: {} as AgentExecutionContext["rag"],
    llm: {} as AgentExecutionContext["llm"],
    llmVendor: {},
    tools: { registry: { listDefinitions: () => [] }, names: new Set() } as unknown as AgentExecutionContext["tools"],
    contextAnalytics: {} as AgentExecutionContext["contextAnalytics"],
    signal: undefined,
    ...(override === "" ? {} : { systemPromptOverride: override }),
  } as AgentExecutionContext;
}

describe("agentReplyDirective", () => {
  it("isChineseLocale whitelists zh tags only", () => {
    expect(isChineseLocale("zh-CN")).toBe(true);
    expect(isChineseLocale("zh")).toBe(true);
    expect(isChineseLocale("en")).toBe(false);
    expect(isChineseLocale(undefined)).toBe(false);
  });

  it("emits the Chinese directive; empty for other locales", () => {
    expect(agentReplyDirective("zh-CN")).toContain("Simplified Chinese");
    expect(agentReplyDirective("en")).toBe("");
    expect(agentReplyDirective(undefined)).toBe("");
  });
});

describe("buildSystemUser reply language", () => {
  it("appends the Chinese directive to the system prompt", () => {
    const { system } = buildSystemUser(context("zh-CN"));
    expect(system).toContain("Respond in Simplified Chinese");
  });

  it("omits the directive for English/absent locale", () => {
    expect(buildSystemUser(context("en")).system).not.toContain("Respond in");
    expect(buildSystemUser(context(undefined)).system).not.toContain("Respond in");
  });

  it("survives a systemPromptOverride", () => {
    const { system } = buildSystemUser(context("zh-CN", "You are a pirate agent."));
    expect(system).toContain("You are a pirate agent.");
    expect(system).toContain("Respond in Simplified Chinese");
  });
});
