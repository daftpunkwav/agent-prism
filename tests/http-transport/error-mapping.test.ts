/**
 * @file error-mapping tests
 * @description Locks error-to-response mapping: AppError statuses and secret-safe 500s.
 */

import { describe, expect, it, vi } from "vitest";
import { buildTestApp, mockDeps } from "./mock-deps.js";
import { AppError } from "@agentprism/application";

describe("http-app error mapping", () => {
  /** Build an app whose getMeta throws the given error. */
  function appWithMetaError(error: unknown) {
    return buildTestApp({
      ...mockDeps(),
      arena: { ...mockDeps().arena, getMeta: vi.fn().mockRejectedValue(error) } as any,
    });
  }

  it("AppError maps to the matching status code", async () => {
    const res404 = await appWithMetaError(AppError.notFound("dimension not found")).request("/api/arena/meta");
    expect(res404.status).toBe(404);
    expect(((await res404.json()) as { detail: string }).detail).toBe("dimension not found");

    const res400 = await appWithMetaError(AppError.badRequest("invalid params")).request("/api/arena/meta");
    expect(res400.status).toBe(400);

    const res500 = await appWithMetaError(AppError.internal("internal error")).request("/api/arena/meta");
    expect(res500.status).toBe(500);
  });

  it("unknown non-AppError maps to 500 without leaking internals", async () => {
    const leaky = new Error("db connection string postgres://user:secret@host/db disconnected");
    const res = await appWithMetaError(leaky).request("/api/arena/meta");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { detail: string };
    // sanitizeErrorMessage only exposes the exception type name
    expect(body.detail).toBe("Error");
    expect(body.detail).not.toContain("secret");
  });
});

