/**
 * @file request-limits tests
 * @description Locks body-size enforcement: Content-Length precheck and in-stream limits.
 */

import { describe, expect, it } from "vitest";
import { buildTestApp, mockDeps } from "./mock-deps.js";

describe("http-app request limits", () => {
  it("oversized request body returns 413", async () => {
    const deps = mockDeps();
    (deps.settings as any).maxRequestSize = 100;
    const app = buildTestApp(deps);
    const res = await app.request("/api/arena/judge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "999",
      },
      body: JSON.stringify({ template_id: "t", answers: { q1: "a" } }),
    });
    expect(res.status).toBe(413);
  });

  it("chunked oversized body without Content-Length returns 413 (in-stream enforcement)", async () => {
    const deps = mockDeps();
    (deps.settings as any).maxRequestSize = 100;
    const app = buildTestApp(deps);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(200)));
        controller.close();
      },
    });
    // undici requires `duplex: "half"` for stream bodies, but the DOM lib's RequestInit
    // has no such key: attach it post-construction instead of lying in the literal.
    const init = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stream as unknown as BodyInit,
    } as RequestInit;
    (init as unknown as Record<string, unknown>).duplex = "half";
    const res = await app.request("/api/arena/judge", init);
    expect(res.status).toBe(413);
  });

});
