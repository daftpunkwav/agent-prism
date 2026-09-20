/**
 * @file body size tests
 * @description Locks the 413 boundary of assertBodySize shared by transport routes.
 */

import { describe, expect, it } from "vitest";
import type { Settings } from "@agentprism/config";
import { AppError } from "@agentprism/application";
import { assertBodySize } from "../src/route-plumbing.js";

function testSettings(overrides: Partial<Settings> = {}): Settings {
  // Partial stub: only the fields the size assertions read; the cast mirrors
  // the composed-settings stubs in apps/server/tests.
  return {
    llmProviderName: "test",
    llmApiKey: "",
    llmBaseUrl: "",
    llmModel: "test-model",
    llmApiFormat: "anthropic_messages",
    llmTemperature: 0,
    backendHost: "127.0.0.1",
    frontendPort: 3000,
    backendPort: 8281,
    corsOrigins: "",
    maxRequestSize: 1024,
    apiToken: "",
    maxConcurrentRuns: 2,
    llmTimeoutMs: 120_000,
    llmMaxRetries: 2,
    breakerThreshold: 3,
    breakerCooldownMs: 30_000,
    askUserWaitMs: 300_000,
    maxConcurrentColumns: 8,
    maxWorkspaces: 32,
    workspaceTtlSeconds: 3600,
    ...overrides,
  } as Settings;
}

describe("assertBodySize", () => {
  it("passes below and exactly at the limit", () => {
    const settings = testSettings();
    expect(() => assertBodySize(1023, settings)).not.toThrow();
    expect(() => assertBodySize(1024, settings)).not.toThrow();
  });

  it("rejects one byte over the limit with 413", () => {
    const settings = testSettings();
    try {
      assertBodySize(1025, settings);
      expect.unreachable("expected a 413 AppError");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(413);
      expect((error as AppError).message).toContain("exceeds");
    }
  });
});

