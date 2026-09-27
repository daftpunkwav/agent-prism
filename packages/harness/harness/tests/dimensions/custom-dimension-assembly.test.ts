/**
 * @file custom dimension assembly tests
 * @description Locks the prompt-assembly seam of a run's active custom dimensions.
 *
 * Responsibilities:
 * - Pin the prompt tag, the prompt hook, and both halves of the memory hook
 * - Pin that no active dimension leaves the composed prompt untouched
 *
 * The hooks are unit-tested at their own seams; these cases pin that
 * buildSystemUser actually invokes them, so a dropped call cannot silently turn
 * a registered dimension into a no-op while every other test stays green.
 */

import { describe, expect, it } from "vitest";
import type { CustomDimension, MemoryRecallResult } from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import type { AgentExecutionContext } from "../../src/execution-context.js";
import { buildSystemUser } from "../../src/prompt/assembly.js";
import { registerCustomDimensions, resolveCustomDimensions } from "../../src/dimensions/custom-dimensions.js";

const probe: CustomDimension = {
  id: "assembly_probe",
  label: "Assembly probe",
  options: [
    { value: "small", label: "Small" },
    { value: "big", label: "Big" },
  ],
  default: "small",
  promptHint: "\n[Probe: {value}]",
  hooks: {
    // Appends instead of replacing, so one assertion reads both the tag and the
    // hook output and the ordering between them stays visible.
    prompt: (input, value) => ({ system: `${input.system}\n[hooked ${value}]` }),
    memory: (_input, value) => ({
      limits: value === "big" ? { episodic: 10, semantic: 10 } : { episodic: 1, semantic: 1 },
    }),
  },
};

/** Dimension whose memory hook replaces the recall itself (the other half of the seam). */
const slicer: CustomDimension = {
  id: "assembly_slicer",
  label: "Assembly slicer",
  options: [{ value: "one", label: "One" }],
  hooks: {
    memory: (input) =>
      input.recall === undefined
        ? undefined
        : { recall: { episodic: input.recall.episodic.slice(0, 1), semantic: [] } },
  },
};

registerCustomDimensions([probe, slicer]);

/** Five episodic entries: enough to exceed both the default cap (3) and the sliced cap (1). */
function recall(): MemoryRecallResult {
  return {
    episodic: Array.from({ length: 5 }, (_, index) => ({
      id: `ep-${index}`,
      task: `task ${index + 1}`,
      framework: "native",
      model: "test-model",
      success: true,
      keyActions: [],
      lessons: "",
      timestamp: index,
      workspaceTag: "",
    })),
    semantic: [],
  };
}

interface ContextOptions {
  custom: Record<string, string>;
  memoryPolicy?: string;
  memoryRecall?: MemoryRecallResult;
}

function contextWith(options: ContextOptions): AgentExecutionContext {
  return {
    identity: { agentId: "a", runId: "r" },
    config: PipelineConfigSchema.parse({
      label: "col",
      harness: "bare",
      memory: options.memoryPolicy ?? "none",
      custom: options.custom,
    }),
    question: "Do the task",
    history: [],
    turn: 1,
    workspace: {
      name: "ws",
      cwd: () => "/tmp/ws",
      fs: {
        readFile: () => {
          throw new Error("missing");
        },
        listFiles: () => [],
        exists: () => false,
      },
    } as unknown as AgentExecutionContext["workspace"],
    tracker: { seedPrompt: () => undefined, asDict: () => ({}) } as unknown as AgentExecutionContext["tracker"],
    clock: { now: () => 1_000 },
    rag: {} as AgentExecutionContext["rag"],
    llm: {} as AgentExecutionContext["llm"],
    llmVendor: null,
    tools: {
      registry: { listDefinitions: () => [] },
      names: new Set<string>(),
      execute: async () => ({ result: "", fileDiff: null, ok: true }),
    } as unknown as AgentExecutionContext["tools"],
    memoryRecall: options.memoryRecall,
    customDimensions: resolveCustomDimensions(options.custom),
  };
}

describe("buildSystemUser custom dimensions", () => {
  it("renders the active dimension's prompt tag and runs its prompt hook", () => {
    const { system } = buildSystemUser(contextWith({ custom: { assembly_probe: "big" } }));
    // The tag states which value is in force; the hook then reshapes the fully
    // composed halves (it is the last seam before the prompt is returned).
    expect(system).toContain("[Probe: big]");
    expect(system).toContain("[hooked big]");
  });

  it("leaves the composed prompt untouched when no dimension is active", () => {
    const { system } = buildSystemUser(contextWith({ custom: {} }));
    expect(system).not.toContain("[Probe:");
    expect(system).not.toContain("[hooked");
  });

  it("mounts the recall under the caps the dimension's memory hook moves", () => {
    const wide = buildSystemUser(
      contextWith({ custom: { assembly_probe: "big" }, memoryPolicy: "full", memoryRecall: recall() }),
    );
    // Beyond the module default of 3 mounted lines: the hook raised the cap.
    expect(wide.system).toContain('"task 5"');

    const narrow = buildSystemUser(
      contextWith({ custom: { assembly_probe: "small" }, memoryPolicy: "full", memoryRecall: recall() }),
    );
    expect(narrow.system).toContain('"task 1"');
    expect(narrow.system).not.toContain('"task 2"');
  });

  it("applies the hook's recall replacement, not only its render caps", () => {
    const { system } = buildSystemUser(
      contextWith({ custom: { assembly_slicer: "one" }, memoryPolicy: "full", memoryRecall: recall() }),
    );
    // The default caps would mount three lines; only the sliced recall may land.
    expect(system).toContain('"task 1"');
    expect(system).not.toContain('"task 2"');
  });
});
