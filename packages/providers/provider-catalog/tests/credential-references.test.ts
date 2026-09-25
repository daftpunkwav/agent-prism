/**
 * @file credential-references tests
 * @description Locks ${env:NAME} resolution and reference-safe masking.
 *
 * Responsibilities:
 * - Pin full-value resolution, missing-variable fail-closed, and passthrough
 */

import { describe, expect, it } from "vitest";
import { resolveCredentialReference } from "../src/endpoints.js";
import { maskApiKey } from "../src/provider-config.js";

describe("resolveCredentialReference", () => {
  it("resolves full-value references through lookup", () => {
    expect(resolveCredentialReference("${env:DEMO_KEY}", (name) => (name === "DEMO_KEY" ? "secret" : undefined))).toBe("secret");
    expect(resolveCredentialReference("  ${env:DEMO_KEY}  ", () => "trimmed")).toBe("trimmed");
  });

  it("fails closed on missing variables", () => {
    expect(resolveCredentialReference("${env:MISSING_XYZ}", () => undefined)).toBe("");
  });

  it("passes non-references and malformed shapes through untouched", () => {
    for (const value of ["sk-plain", "", "prefix-${env:A}", "${env:}", "${env:9BAD}", "${ENV:A}", "${env:A} trailing"]) {
      expect(resolveCredentialReference(value, () => "secret")).toBe(value);
    }
  });
});

describe("maskApiKey with references", () => {
  it("masks references as <env> without leaking the variable name", () => {
    expect(maskApiKey("${env:DEEPSEEK_API_KEY}")).toBe("<env>");
  });
});
