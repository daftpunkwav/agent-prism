/**
 * @file matrix-routes tests
 * @description Locks the matrix SSE stream: progress events plus final report.
 */

import { describe, expect, it, vi } from "vitest";
import { buildTestApp, mockDeps } from "./mock-deps.js";

describe("http-app arena matrix streaming", () => {
  it("POST /api/arena/matrix streams progress and a final report", async () => {
    const deps = mockDeps();
    async function* fakeMatrix() {
      yield { kind: "progress", template_id: "t1", status: "scored", score: "1/1", error: "" };
      yield { kind: "report", report: { cells: [], startedAt: 1, finishedAt: 2 } };
    }
    (deps.matrix as any).runMatrix = vi.fn().mockImplementation(() => fakeMatrix());
    const app = buildTestApp(deps);
    const res = await app.request("/api/arena/matrix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cells: [{ template_id: "t1" }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("matrix_progress");
    expect(text).toContain("matrix_report");
    expect(deps.matrix.runMatrix).toHaveBeenCalledWith(
      [{ template_id: "t1", selections: [], dimension: undefined, baseline: undefined }],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("POST /api/arena/matrix returns 422 on empty cells", async () => {
    const app = buildTestApp(mockDeps());
    const res = await app.request("/api/arena/matrix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cells: [] }),
    });
    expect(res.status).toBe(422);
  });
});
