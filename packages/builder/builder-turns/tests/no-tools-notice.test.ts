/**
 * @file no-tools-notice tests
 * @description Locks the disabled-tool-system notice copy.
 */

import { describe, expect, it } from "vitest";
import { buildNoToolsNotice } from "../src/composition.js";

describe("buildNoToolsNotice", () => {
  it("states that the tool system is disabled", () => {
    expect(buildNoToolsNotice()).toMatch(/disabled/i);
  });
});
