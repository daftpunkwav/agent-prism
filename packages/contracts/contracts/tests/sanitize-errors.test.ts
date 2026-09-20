/**
 * @file sanitize-errors tests
 * @description Locks error sanitizing: only the error type leaks, safe messages pass through.
 */

import { describe, expect, it } from "vitest";
import {
  sanitizeErrorMessage,
  ConfigurationError,
} from "@agentprism/contracts";

describe("sanitizeErrorMessage smoke", () => {
  it("Error instances only expose the type name", () => {
    expect(sanitizeErrorMessage(new TypeError("sensitive internal detail"))).toBe("TypeError");
  });

  it("ConfigurationError messages pass through verbatim", () => {
    expect(
      sanitizeErrorMessage(new ConfigurationError("API Key is not configured; set it in Provider settings first")),
    ).toBe("API Key is not configured; set it in Provider settings first");
  });

  it("unknown shapes fall back to Error", () => {
    expect(sanitizeErrorMessage(42)).toBe("Error");
  });
});

