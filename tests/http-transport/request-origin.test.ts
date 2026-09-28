/**
 * @file request-origin tests
 * @description Locks the cross-site state-change guard: foreign-Origin mutating
 *              requests are rejected (drive-by localhost defense), while
 *              origin-less clients and allowlisted frontend origins pass.
 */

import { describe, expect, it } from "vitest";
import { buildTestApp, mockDeps } from "./mock-deps.js";

describe("http-app cross-site guard", () => {
  it("rejects a POST carrying a non-allowlisted Origin (simple request, no preflight)", async () => {
    const app = buildTestApp(mockDeps());
    const res = await app.request("/api/settings/memory/clear", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects a foreign-Origin POST even when the body parses as JSON", async () => {
    const app = buildTestApp(mockDeps());
    const res = await app.request("/api/arena/answer", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: "a", question_id: "q", answer: "x" }),
    });
    expect(res.status).toBe(403);
  });

  it("passes a POST from an allowlisted frontend origin", async () => {
    // mockDeps settings: frontendPort 3000 → http://localhost:3000 is allowlisted.
    const app = buildTestApp(mockDeps());
    const res = await app.request("/api/settings/memory/clear", {
      method: "POST",
      headers: { Origin: "http://localhost:3000" },
    });
    expect(res.status).toBe(200);
  });

  it("passes an origin-less POST (curl / server-to-server parity)", async () => {
    const app = buildTestApp(mockDeps());
    const res = await app.request("/api/settings/memory/clear", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("does not gate reads: a GET with a foreign Origin still answers", async () => {
    const app = buildTestApp(mockDeps());
    const res = await app.request("/api/arena/meta", {
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects a PUT with a foreign Origin", async () => {
    const app = buildTestApp(mockDeps());
    const res = await app.request("/api/settings/knobs", {
      method: "PUT",
      headers: { Origin: "https://evil.example" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });
});
