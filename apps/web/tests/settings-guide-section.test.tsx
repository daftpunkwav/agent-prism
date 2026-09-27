// @vitest-environment jsdom
/**
 * @file settings guide section tests
 * @description Locks the guide tab: every documented group renders real copy.
 *
 * Responsibilities:
 * - Pin that each GROUPS entry has title/body copy in both catalogs
 * - Pin that the section renders the intro, the groups, and the skin picker
 *
 * A group added without catalog entries would render its raw key string, which no
 * other gate catches (check:i18n compares key sets, not which keys a component uses).
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { GuideSection } from "../src/app/settings/GuideSection.js";

/** Keys the section renders; kept in sync with GROUPS in the component. */
const GROUP_KEYS = ["connections", "thinking", "decode", "runtime", "memory", "skills", "mcp"] as const;

/** Dot-key lookup mirroring resolveMessage, so the test reads keys like the app does. */
function message(locale: "en" | "zh-CN", key: string): string | null {
  let node: unknown = getCatalog(locale);
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : null;
}

function renderSection() {
  return render(
    <I18nProvider initialLocale="en">
      <GuideSection />
    </I18nProvider>,
  );
}

describe("GuideSection", () => {
  afterEach(cleanup);

  it.each(["en", "zh-CN"] as const)("has title and body copy for every group (%s)", (locale) => {
    for (const key of GROUP_KEYS) {
      expect(message(locale, `settings.guide.${key}.title`), `${key} title`).toBeTruthy();
      expect(message(locale, `settings.guide.${key}.body`), `${key} body`).toBeTruthy();
    }
  });

  it("renders the intro, every group heading, and the skin picker", () => {
    renderSection();
    for (const key of GROUP_KEYS) {
      expect(screen.getByText(message("en", `settings.guide.${key}.title`) as string)).toBeTruthy();
    }
    // The degraded fallback renders the raw key (prod) or a marker (dev); neither may appear.
    expect(screen.queryByText(/^settings\.guide\./)).toBeNull();
    expect(screen.getByText(message("en", "settings.guide.intro") as string)).toBeTruthy();
    expect(screen.getByText(message("en", "settings.skin.label") as string)).toBeTruthy();
  });
});
