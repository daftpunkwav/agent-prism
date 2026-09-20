/**
 * @file template labels tests
 * @description Locks the task-template display overlay: translation wins, fallback covers missing keys.
 */

import { describe, expect, it, vi } from "vitest";
import type { useT } from "@/i18n/useT";
import { templateName, templateQuestion } from "../src/app/arena/templateLabels.js";

type TFn = ReturnType<typeof useT>;

/** Fake translator returning a canned string per key. */
function fakeT(resolve: (key: string) => string): TFn {
  return vi.fn((key: string) => resolve(key)) as unknown as TFn;
}

describe("template display labels", () => {
  it("prefers the localized catalog entry for name and question", () => {
    const t = fakeT((key) => (key === "arena.templates.strawberry.name" ? "Strawberry" : "Strawberry prompt"));
    expect(templateName(t, "strawberry", "Backend name")).toBe("Strawberry");
    expect(templateQuestion(t, "strawberry", "Backend question")).toBe("Strawberry prompt");
  });

  it("falls back to the backend text when the catalog entry is missing (⟦ marker)", () => {
    const t = fakeT(() => "⟦arena.templates.unknown.name⟧");
    expect(templateName(t, "unknown", "Backend name")).toBe("Backend name");
    expect(templateQuestion(t, "unknown", "Backend question")).toBe("Backend question");
  });

  it("falls back when the translator echoes the key instead of translating", () => {
    const t = fakeT((key) => key);
    expect(templateName(t, "strawberry", "Backend name")).toBe("Backend name");
  });
});
