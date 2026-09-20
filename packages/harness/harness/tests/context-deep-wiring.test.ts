/**
 * @file context-deep-wiring tests
 * @description Covers journal-aware compaction, stateful instructions, analytics summary.
 */

import { describe, expect, it } from "vitest";
import { CompactionJournal } from "@agentprism/context-compaction";
import { applyCheckpointCompactionWithJournal } from "../src/context/checkpoint-strategy.js";
import { createContextAnalytics, summarizeAnalytics } from "../src/context/analytics.js";
import { createInstructionState, renderWorkspaceInstructionsWithState } from "../src/prompt/instructions.js";
import type { LlmMessage } from "@agentprism/contracts";

function bigMessages(count: number): LlmMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: "user" as const,
    content: `question ${i} ${"x".repeat(600)}`,
  }));
}

describe("context deep wiring", () => {
  it("records a journal entry when checkpoint compaction fires", () => {
    const journal = new CompactionJournal();
    const { checkpointEmitted } = applyCheckpointCompactionWithJournal(bigMessages(30), journal, {
      compactTargetTokens: 500,
      now: 123,
    });
    expect(checkpointEmitted).toBe(true);
    expect(journal.size).toBe(1);
    expect(journal.totalSaved()).toBeGreaterThanOrEqual(0);
  });

  it("skips re-render when instruction digest is unchanged", () => {
    const state = createInstructionState();
    const fs = {
      exists: () => true,
      readFile: () => "# rules\nBe terse.",
    };
    const first = renderWorkspaceInstructionsWithState(fs, state);
    expect(first.text).toContain("terse");
    const second = renderWorkspaceInstructionsWithState(fs, state);
    expect(second.changed).toBe(false);
    expect(second.digest).toBe(first.digest);
  });

  it("summarizes empty analytics with stable lines", () => {
    const analytics = createContextAnalytics();
    const summary = summarizeAnalytics(analytics);
    expect(summary.usage).toContain("no turns");
    expect(summary.effectiveness).toContain("no observations");
  });
});
