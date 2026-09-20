/**
 * @file runtime knobs tests
 * @description Locks knob defaults, normalization clamping, and store persistence/hot-apply.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AtomicJsonFile } from "@agentprism/persistence";
import type { Settings } from "../src/settings.js";
import { defaultRuntimeKnobs, normalizeRuntimeKnobs, RuntimeKnobsStore } from "../src/knobs.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop() as string;
    rmSync(root, { recursive: true, force: true });
  }
});

function settingsStub(): Settings {
  return {
    contextWindowMessages: 12,
    contextCharsPerToken: 4,
    contextSummaryMaxChars: 4000,
    contextTokenBudgetChars: 24000,
    contextTokenBudgetKeepTurns: 6,
    contextToolTailBudgetChars: 4000,
    contextToolTailKeepChars: 1200,
    contextBudgetTokens: 6000,
    contextCheckpointTargetTokens: 2000,
  } as unknown as Settings;
}

describe("defaultRuntimeKnobs", () => {
  it("derives the context knobs from settings and pins reasoning/harness defaults", () => {
    const knobs = defaultRuntimeKnobs(settingsStub());
    expect(knobs.contextWindowMessages).toBe(12);
    expect(knobs.contextTokenBudgetChars).toBe(24000);
    expect(knobs.selfConsistencyN).toBe(5);
    expect(knobs.totWidth).toBe(3);
    expect(knobs.crewaiProcess).toBe("sequential");
    expect(knobs.harnessRetries).toEqual({ verify: 2, reflect: 2, selfEvolve: 2 });
  });

  it("clamps out-of-range env settings into the knob ranges", () => {
    const knobs = defaultRuntimeKnobs({
      ...settingsStub(),
      contextWindowMessages: 999,
      contextSummaryMaxChars: 1,
    } as unknown as Settings);
    expect(knobs.contextWindowMessages).toBe(200);
    expect(knobs.contextSummaryMaxChars).toBe(500);
  });
});

describe("normalizeRuntimeKnobs", () => {
  it("applies valid values and clamps invalid ones over the base", () => {
    const base = defaultRuntimeKnobs(settingsStub());
    const next = normalizeRuntimeKnobs(
      {
        contextWindowMessages: 20,
        contextSummaryMaxChars: 1,
        totWidth: 99,
        crewaiProcess: "hierarchical",
        selfConsistencyN: "not a number",
        harnessRetries: { verify: 4, reflect: 99 },
      },
      base,
    );
    expect(next.contextWindowMessages).toBe(20);
    expect(next.contextSummaryMaxChars).toBe(500);
    expect(next.totWidth).toBe(5);
    expect(next.crewaiProcess).toBe("hierarchical");
    expect(next.selfConsistencyN).toBe(base.selfConsistencyN);
    expect(next.harnessRetries).toEqual({ verify: 4, reflect: 5, selfEvolve: 2 });
  });

  it("keeps every base value for a non-object payload", () => {
    const base = defaultRuntimeKnobs(settingsStub());
    expect(normalizeRuntimeKnobs(null, base)).toEqual(base);
    expect(normalizeRuntimeKnobs("junk", base)).toEqual(base);
  });
});

describe("RuntimeKnobsStore", () => {
  it("persists updates and fires the hot-apply callback", async () => {
    const root = mkdtempSync(join(tmpdir(), "runtime-knobs-"));
    roots.push(root);
    const file = new AtomicJsonFile(join(root, "runtime_knobs.json"));
    const onUpdate = vi.fn();
    const store = new RuntimeKnobsStore(file, defaultRuntimeKnobs(settingsStub()), onUpdate);

    const next = store.update({ contextWindowMessages: 24 });
    expect(next.contextWindowMessages).toBe(24);
    expect(onUpdate).toHaveBeenCalledWith(next);
    // Atomic write is async: poll briefly for the persisted payload.
    await vi.waitFor(() => {
      expect(JSON.parse(readFileSync(join(root, "runtime_knobs.json"), "utf8")).contextWindowMessages).toBe(24);
    });
  });

  it("loads saved overrides over the defaults on construction", async () => {
    const root = mkdtempSync(join(tmpdir(), "runtime-knobs-"));
    roots.push(root);
    const filePath = join(root, "runtime_knobs.json");
    const file = new AtomicJsonFile(filePath);
    await file.write({ contextWindowMessages: 30, harnessRetries: { verify: 5 } });

    const store = new RuntimeKnobsStore(file, defaultRuntimeKnobs(settingsStub()));
    expect(store.current().contextWindowMessages).toBe(30);
    expect(store.current().harnessRetries.verify).toBe(5);
    // Untouched fields keep their defaults.
    expect(store.current().harnessRetries.reflect).toBe(2);
  });
});
