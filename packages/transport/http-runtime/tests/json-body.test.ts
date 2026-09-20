/**
 * @file json body tests
 * @description Locks JSON body reading and schema-error mapping shared by transport routes.
 */

import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import type { Settings } from "@agentprism/config";
import { AppError } from "@agentprism/application";
import { parseJsonBody, readJsonRaw } from "../src/route-plumbing.js";

function testSettings(overrides: Partial<Settings> = {}): Settings {
  // Partial stub: only the fields the body-parsing assertions read; the cast
  // mirrors the composed-settings stubs in apps/server/tests.
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

// The route plumbing only touches c.get("appSettings") and c.req.raw: a real Request
// supplies the streaming body without standing up a Hono app per case.
function fakeContext(body: string | null, settings: Settings): Context {
  const request =
    body === null
      ? new Request("http://localhost/t")
      : new Request("http://localhost/t", { method: "POST", body });
  return {
    get: () => settings,
    req: { raw: request },
  } as unknown as Context;
}

describe("readJsonRaw", () => {
  it("parses an empty body as {}", async () => {
    await expect(readJsonRaw(fakeContext(null, testSettings()))).resolves.toEqual({});
  });

  it("parses valid JSON", async () => {
    await expect(readJsonRaw(fakeContext('{"a":1}', testSettings()))).resolves.toEqual({ a: 1 });
  });

  it("maps malformed JSON onto 400", async () => {
    try {
      await readJsonRaw(fakeContext("oops", testSettings()));
      expect.unreachable("expected a 400 AppError");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(400);
    }
  });
});

describe("parseJsonBody", () => {
  const echo = {
    safeParse: (data: unknown) => ({ success: true as const, data }),
  };

  it("returns validated data", async () => {
    const context = fakeContext('{"a":1}', testSettings());
    await expect(parseJsonBody(context, echo)).resolves.toEqual({ a: 1 });
  });

  it("maps schema failures onto 422 with the first issue", async () => {
    const failing = {
      safeParse: (_data: unknown) => ({
        success: false as const,
        error: { issues: [{ message: "first problem" }, { message: "second problem" }] },
      }),
    };
    const context = fakeContext('{"a":1}', testSettings());
    try {
      await parseJsonBody(context, failing);
      expect.unreachable("expected a 422 AppError");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(422);
      expect((error as AppError).message).toContain("first problem");
    }
  });
});
