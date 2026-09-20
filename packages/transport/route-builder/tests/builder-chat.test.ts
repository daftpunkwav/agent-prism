/**
 * @file builder chat tests
 * @description Locks the builder SSE chat route: chunk delivery, DONE framing, error channel.
 */

import { describe, expect, it, vi } from "vitest";
import type { Settings } from "@agentprism/config";
import { BuilderError } from "@agentprism/builder-service";
import { createHttpApplication, type HttpApp, type HttpApplicationDeps } from "@agentprism/http-runtime";
import { registerBuilderRoutes } from "../src/builder.js";

/** Composed builder test app: shell + builder routes only. */
function buildBuilderTestApp(deps: HttpApplicationDeps): HttpApp {
  const app = createHttpApplication(deps);
  registerBuilderRoutes(app, deps);
  return app;
}

function testSettings(): Settings {
  // Partial stub: only the fields the shell middleware reads; the cast mirrors
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
    maxRequestSize: 1024 * 1024,
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
  } as Settings;
}

function mockDeps(chatTurn: unknown): HttpApplicationDeps {
  return {
    settings: testSettings(),
    arena: {} as any,
    arenaLogs: { columnLogs: vi.fn().mockReturnValue({ events: [], wire: [] }) } as any,
    matrix: {} as any,
    providers: {} as any,
    workspaces: {} as any,
    projects: {} as any,
    builder: {
      catalog: vi.fn(),
      createSession: vi.fn(),
      listSessions: vi.fn().mockReturnValue([]),
      getSessionDetail: vi.fn(),
      patchComposition: vi.fn(),
      deleteSession: vi.fn(),
      abortTurn: vi.fn(),
      chatTurn,
    } as any,
    sessions: { listSessions: async () => [], getSession: async () => null } as any,
    threads: { list: () => [], getDetail: () => ({ thread: {}, history: [] }), create: () => ({}), fork: () => ({}), deleteThread: () => ({}), run: () => ({}), assertIdle: () => undefined } as any,
    clock: { now: () => 1700000000000 },
  };
}

function chatRequest(message: unknown) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  } as RequestInit;
}

describe("builder chat route", () => {
  it("streams chunks as builder events closed by DONE", async () => {
    async function* turns() {
      yield { stream: "trace", message: "hi" };
    }
    const chatTurn = vi.fn().mockImplementation(() => turns());
    const app = buildBuilderTestApp(mockDeps(chatTurn));
    const res = await app.request("/api/builder/sessions/s1/chat", chatRequest("hello"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(chatTurn).toHaveBeenCalledWith("s1", "hello", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(text).toContain('"stream":"trace"');
    expect(text).toContain("[DONE]");
  });

  it("forwards attachments to the turn", async () => {
    async function* turns() {
      yield { stream: "trace", message: "hi" };
    }
    const chatTurn = vi.fn().mockImplementation(() => turns());
    const app = buildBuilderTestApp(mockDeps(chatTurn));
    const res = await app.request(
      "/api/builder/sessions/s1/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", attachments: [{ name: "a.txt", content: "x" }] }),
      } as RequestInit,
    );
    expect(res.status).toBe(200);
    expect(chatTurn).toHaveBeenCalledWith(
      "s1",
      "hello",
      expect.objectContaining({ attachments: [{ name: "a.txt", content: "x" }] }),
    );
  });

  it("delivers a BuilderError detail as a fatal error chunk", async () => {
    async function* turns(): AsyncGenerator<unknown> {
      throw BuilderError.invalid("turn boom");
      yield { stream: "trace" };
    }
    const app = buildBuilderTestApp(mockDeps(vi.fn().mockImplementation(() => turns())));
    const res = await app.request("/api/builder/sessions/s1/chat", chatRequest("hello"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("turn boom");
    expect(text).toContain("[DONE]");
  });

  it("sanitizes non-domain failures down to the error type name", async () => {
    async function* turns(): AsyncGenerator<unknown> {
      throw new Error("internal /workspace/secret path");
      yield { stream: "trace" };
    }
    const app = buildBuilderTestApp(mockDeps(vi.fn().mockImplementation(() => turns())));
    const res = await app.request("/api/builder/sessions/s1/chat", chatRequest("hello"));
    const text = await res.text();
    expect(text).toContain('"message":"Error"');
    expect(text).not.toContain("secret path");
  });

  it("rejects empty messages with 422", async () => {
    const app = buildBuilderTestApp(mockDeps(vi.fn()));
    const res = await app.request("/api/builder/sessions/s1/chat", chatRequest(""));
    expect(res.status).toBe(422);
  });
});
