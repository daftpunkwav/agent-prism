/**
 * @file builtin-sections
 * @description Registers builtin prompt sections into a PromptSectionRegistry.
 *
 * Responsibilities:
 * - Contribute profile, context-hint, harness, and reasoning sections
 * - Expose the builtin registry instance
 */

import type { ContextStrategy, HarnessLevel, PromptProfile, PromptSection, ReasoningMode } from "@agentprism/contracts";
import { REASONING_MODE_META } from "@agentprism/contracts";
import { MapPromptSectionRegistry } from "./section-registry.js";

/** Base system prompt (coding-agent behavior constraints). The tool roster is rendered dynamically at assembly time (see buildSystemUser). */
export const BASE_SYSTEM = `You are a coding agent inside a workspace.
Rules:
1. Create and modify files inside the isolated working directory for the user's task; commands execute with the workspace root as cwd.
2. Plan before acting: track multi-step work with a task list; prefer editing existing files over rewriting them.
3. Keep answers concise; when done, state artifact paths and how to run them.`;

interface ProfileSpec {
  system: string;
  userSuffix: string;
}

const PROFILES: Record<PromptProfile, ProfileSpec> = {
  zero_shot: { system: BASE_SYSTEM, userSuffix: "" },
  few_shot: {
    system:
      BASE_SYSTEM +
      "\n\n[Few-shot examples]\n" +
      "Example 1 — create and verify:\n" +
      'Task: create hello.py that prints "hello".\n' +
      "Assistant: I will write the file, then run it to verify.\n" +
      'write hello.py with print("hello") → file created\n' +
      "run python hello.py → output: hello\n" +
      "Final: artifact hello.py; verified by execution.\n\n" +
      "Example 2 — fix a failing script:\n" +
      "Task: fix division.py, it crashes with ZeroDivisionError.\n" +
      "Assistant: read the script first, find the unguarded divisor, then patch it.\n" +
      "read division.py → line 4 divides by len(data), which can be 0\n" +
      'edit division.py → guard: if not data, print "no data" and exit\n' +
      "run python division.py → output: no data\n" +
      "Final: artifact division.py fixed; verified by execution.\n\n" +
      "Example 3 — multi-step change:\n" +
      "Task: add a --verbose flag to scraper.py.\n" +
      "Assistant: plan: read the CLI parsing, add the flag, thread it through, run a smoke test.\n" +
      "read scraper.py → argparse setup at the top\n" +
      "edit scraper.py → add --verbose; log when set\n" +
      "run python scraper.py --verbose → verbose logging active\n" +
      "Final: artifact scraper.py updated; verified by execution.",
    userSuffix: "",
  },
  cot_prompt: {
    system: BASE_SYSTEM + "\nBriefly state the plan first, then call tools.",
    userSuffix: "\nLet's think step by step.",
  },
  structured: {
    system: BASE_SYSTEM + '\nFinal reply JSON: {"plan":"...","files":["..."],"how_to_run":"..."}',
    userSuffix: "\nSummarize artifacts as JSON.",
  },
  terse: {
    system: BASE_SYSTEM + "\nKeep prose minimal: prefer tool calls over explanations, and keep the final reply as short as the task allows.",
    userSuffix: "\nBe concise.",
  },
};

const CONTEXT_HINTS: Record<ContextStrategy, string> = {
  sliding: "\n[Context: sliding window]",
  summary: "\n[Context: summary compression]",
  vector: "\n[Context: vector retrieval]",
  hybrid: "\n[Context: hybrid]",
  tool_tail: "\n[Context: tool-tail pruning (reasoning kept, bulky tool results head+tail compacted)]",
  token_budget: "\n[Context: token-budget fit (older tool results dropped first, ledger records the loss)]",
  budget: "\n[Context: source budget (per-source allowances, newest turns kept, ledger records cuts)]",
  checkpoint: "\n[Context: checkpoint compaction (oldest span condensed into a tagged checkpoint envelope)]",
};

const HARNESS_SUFFIXES: Record<HarnessLevel, string> = {
  bare: "",
  verify: "\n\nAfter execution, verify the answer is complete and correct.",
  reflect: "\n\nExecute → evaluate → reflect and improve.",
  self_evolve: "\n\nExecute → evaluate → reflect → propose improvements.",
};

const REASONING_SUFFIXES: Record<ReasoningMode, { systemSuffix: string; userSuffix: string }> = {
  react: {
    systemSuffix:
      "\n\nUse ReAct mode with mandatory step labels, kept consistent across every step of the task: " +
      "write `Action: ...` immediately before EVERY tool call (what you are about to do and why), " +
      "and `Observation: ...` immediately after EVERY tool result (what the result shows). " +
      "When one message carries both a result summary and the next step, put them on separate lines in that order: " +
      "`Observation: ...` first, then `Action: ...`. " +
      "Never omit or rename these labels; drop them only in the final answer once the task is done.",
    userSuffix: "",
  },
  cot_tool: {
    systemSuffix:
      "\n\nUse Chain-of-Thought + Tool mode: analyze the problem with a full reasoning chain, plan all needed steps, then execute tool calls.",
    userSuffix: "\n\nFirst analyze the problem in detail, list reasoning steps, then execute tools.",
  },
  tot: {
    systemSuffix:
      "\n\nUse Tree-of-Thought mode: for each step generate multiple candidate plans, evaluate each, and continue with the best one.",
    userSuffix: "",
  },
  reflexion: {
    systemSuffix:
      "\n\nUse Reflexion mode: after execution evaluate result quality, reflect on improvements, and retry if needed. At most 2 retries.",
    userSuffix: "",
  },
  self_consistency: {
    systemSuffix:
      "\n\nUse Self-Consistency mode: answer the task definitively; the system runs several independent attempts of the same task and selects the majority answer.",
    userSuffix: "",
  },
};

function profileSection(id: PromptProfile, spec: ProfileSpec): PromptSection {
  return {
    id: `profile:${id}`,
    contribute({ question }) {
      return {
        system: spec.system,
        user: question.trim() + spec.userSuffix,
      };
    },
  };
}

function contextHintSection(id: ContextStrategy, hint: string): PromptSection {
  return {
    id: `context_hint:${id}`,
    contribute() {
      return { system: hint };
    },
  };
}

function harnessSection(id: HarnessLevel, suffix: string): PromptSection {
  return {
    id: `harness:${id}`,
    contribute() {
      return suffix === "" ? {} : { system: suffix };
    },
  };
}

function reasoningSection(id: ReasoningMode, suffixes: { systemSuffix: string; userSuffix: string }): PromptSection {
  return {
    id: `reasoning:${id}`,
    contribute() {
      return {
        system: suffixes.systemSuffix,
        user: suffixes.userSuffix === "" ? undefined : suffixes.userSuffix,
      };
    },
  };
}

/** Creates a registry with all builtin prompt sections registered. */
export function createBuiltinPromptSectionRegistry(): MapPromptSectionRegistry {
  const registry = new MapPromptSectionRegistry();
  for (const [id, spec] of Object.entries(PROFILES) as Array<[PromptProfile, ProfileSpec]>) {
    registry.register(profileSection(id, spec));
  }
  for (const [id, hint] of Object.entries(CONTEXT_HINTS) as Array<[ContextStrategy, string]>) {
    registry.register(contextHintSection(id, hint));
  }
  for (const [id, suffix] of Object.entries(HARNESS_SUFFIXES) as Array<[HarnessLevel, string]>) {
    registry.register(harnessSection(id, suffix));
  }
  for (const [id, suffixes] of Object.entries(REASONING_SUFFIXES) as Array<
    [ReasoningMode, { systemSuffix: string; userSuffix: string }]
  >) {
    registry.register(reasoningSection(id, suffixes));
  }
  // Keep REASONING_MODE_META in sync: every meta mode must have a suffix entry.
  for (const meta of REASONING_MODE_META) {
    if (!Object.hasOwn(REASONING_SUFFIXES, meta.mode)) {
      throw new Error(`Missing reasoning suffix for mode: ${meta.mode}`);
    }
  }
  return registry;
}

const builtinPromptRegistry = createBuiltinPromptSectionRegistry();

/** Shared builtin registry for prompt assembly. */
export function getBuiltinPromptSectionRegistry(): MapPromptSectionRegistry {
  return builtinPromptRegistry;
}

export { PROFILES, CONTEXT_HINTS, HARNESS_SUFFIXES, REASONING_SUFFIXES };
