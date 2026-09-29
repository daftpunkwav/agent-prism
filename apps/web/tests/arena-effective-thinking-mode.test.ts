/**
 * @file arena effective thinking mode tests
 * @description Locks baseline thinking-mode normalization against the served option set.
 *
 * Responsibilities:
 * - Pin the levels fallback for drafts kept from endpoints that no longer offer budget pairs
 * - Pin draft-wins and served-default ordering
 */

import { describe, expect, it } from "vitest";
import type { ArenaMeta } from "@agentprism/client";
import { effectiveThinkingMode } from "../src/app/arena/arenaConstants.js";

function metaWithThinkingModeOptions(values: string[]): ArenaMeta {
  return {
    baseline_defaults: { thinking_mode: "levels" },
    baseline_fields: [
      {
        field: "thinking_mode",
        label: "Thinking mode",
        group: "decode",
        dimension: null,
        input: "select",
        default: "levels",
        options: values.map((value) => ({ value, label: value })),
      },
    ],
  } as unknown as ArenaMeta;
}

describe("effectiveThinkingMode", () => {
  it("keeps an explicitly stored budget mode while the server still offers it", () => {
    const meta = metaWithThinkingModeOptions(["levels", "budget"]);
    expect(effectiveThinkingMode(meta, { thinking_mode: "budget" })).toBe("budget");
  });

  it("falls back to levels for a stored mode the server no longer serves", () => {
    // Draft kept from an earlier anthropic endpoint; the current default
    // endpoint is level-mapped, so the stale budget pin must not disable the
    // level field in the UI nor travel on the wire.
    const meta = metaWithThinkingModeOptions(["levels"]);
    expect(effectiveThinkingMode(meta, { thinking_mode: "budget" })).toBe("levels");
  });

  it("follows the served default when the draft has no mode", () => {
    const meta = {
      baseline_defaults: { thinking_mode: "budget" },
      baseline_fields: [
        {
          field: "thinking_mode",
          input: "select",
          default: "budget",
          options: [
            { value: "levels", label: "levels" },
            { value: "budget", label: "budget" },
          ],
        },
      ],
    } as unknown as ArenaMeta;
    expect(effectiveThinkingMode(meta, {})).toBe("budget");
  });

  it("defaults to levels without meta or served options", () => {
    expect(effectiveThinkingMode(null, {})).toBe("levels");
    expect(effectiveThinkingMode(null, { thinking_mode: "budget" })).toBe("levels");
  });
});
