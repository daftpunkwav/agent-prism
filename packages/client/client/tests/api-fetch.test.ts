/**
 * @file apiFetch tests
 * @description Covers apiFetch error classification.
 *
 * Responsibilities:
 * - Pin how apiFetch failures are classified into typed errors
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "@agentprism/client";

/** Fake fetch: watches the incoming signal and rejects with signal.reason on abort (matches real fetch/undici). */
function neverResolvingFetch(): typeof fetch {
  return vi.fn(((_url: string | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }
    });
  }) as unknown as typeof fetch);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch error classification", () => {
  it("timeout (AbortSignal.timeout TimeoutError) maps to Request timed out", async () => {
    vi.stubGlobal("fetch", neverResolvingFetch());
    const err = await apiFetch("http://localhost/x", { timeout: 20 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("Request timed out");
    expect((err as ApiError).kind).toBe("network");
  });

  it("user cancel is passed through unchanged, not wrapped as ApiError", async () => {
    vi.stubGlobal("fetch", neverResolvingFetch());
    const controller = new AbortController();
    const pending = apiFetch("http://localhost/x", { timeout: 10_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    const err = await pending.catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as Error).name).toBe("AbortError");
  });

  it("connection failure (TypeError) maps to unable-to-connect message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const err = await apiFetch("http://localhost/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("Unable to connect to the server; check that the backend is running");
  });
});
