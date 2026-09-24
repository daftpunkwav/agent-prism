/**
 * @file strategy plugin dispatch tests
 * @description Locks the live-path dispatch of registered context plugins: a
 * selectable id must run through applyContextPipeline with the shared tail,
 * and unregistered ids must still fail closed.
 */

import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@agentprism/contracts";
import { UnknownPromptConfigError } from "../../src/prompt/errors.js";
import { applyContextPipeline, finishContextPipeline } from "../../src/context/pipeline.js";
import {
  listContextStrategyPlugins,
  registerContextStrategyPlugins,
} from "../../src/context/strategy-plugins.js";

const transcript: LlmMessage[] = [
  { role: "user", content: "task" },
  { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read", args: {} }] },
  { role: "tool", content: "raw tool output", toolCallId: "c1", name: "read" },
];

// Unique id: registration is module-level and shared by every test in this
// file, so ids here must not collide with other registrations.
const PLUGIN_ID = "test_assembly_marker";

registerContextStrategyPlugins([
  {
    id: PLUGIN_ID,
    label: "Test assembly",
    apply: (messages) => messages.map((m) => (m.role === "tool" ? { ...m, content: "[omitted]" } : m)),
  },
]);

describe("applyContextPipeline plugin dispatch", () => {
  it("runs a registered plugin id through the shared pipeline tail", () => {
    const out = applyContextPipeline(transcript, PLUGIN_ID);
    // The plugin transform applied...
    const tool = out.find((m) => m.role === "tool");
    expect(tool?.content).toBe("[omitted]");
    // ...and pairing survived sanitize + tool grounding (shared tail).
    expect(out.some((m) => m.role === "assistant" && (m.toolCalls?.length ?? 0) > 0)).toBe(true);
  });

  it("keeps builtin ids on the builtin path", () => {
    const out = applyContextPipeline(transcript, "sliding");
    expect(out.find((m) => m.role === "tool")?.content).toBe("raw tool output");
  });

  it("still fails closed for unregistered ids", () => {
    expect(() => applyContextPipeline(transcript, "ghost_strategy")).toThrow(UnknownPromptConfigError);
  });

  it("lists registered plugins with builtin ids untouched", () => {
    expect(listContextStrategyPlugins().map((p) => p.id)).toContain(PLUGIN_ID);
  });

  it("runs the shared tail directly and appends the budget reminder", () => {
    const grounded = finishContextPipeline(transcript);
    expect(grounded.find((m) => m.role === "tool")?.content).toBe("raw tool output");
    // ~1000 estimated tokens against a 10-token budget crosses the threshold.
    const long: LlmMessage[] = [{ role: "user", content: "x".repeat(4000) }];
    const reminded = finishContextPipeline(long, { contextBudgetTokens: 10 });
    expect(reminded.some((m) => m.role === "system" && m.content.startsWith("[Context budget]"))).toBe(true);
  });
});
