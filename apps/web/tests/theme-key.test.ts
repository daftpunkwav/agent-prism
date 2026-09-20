/**
 * @file theme key tests
 * @description Pins the theme persistence key shared by the layout inline script and ThemeToggle.
 */

import { describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY } from "../src/theme.js";

describe("THEME_STORAGE_KEY", () => {
  it("keeps the persistence key that both sides read", () => {
    // The literal is the storage contract: renaming it would orphan saved preferences.
    expect(THEME_STORAGE_KEY).toBe("agentprism-theme");
  });
});
