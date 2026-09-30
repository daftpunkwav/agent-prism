/**
 * @file sse stream test
 * @description Pins the streamSSE boundary re-export: route-* leaves consume hono's
 *              SSE helper only through the http-runtime seam, so the re-export must
 *              keep serving a working event stream.
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { streamSSE } from "../src/route-plumbing.js";

describe("streamSSE boundary re-export", () => {
  it("serves hono's SSE helper through the http-runtime export", async () => {
    const app = new Hono();
    app.get("/stream", (c) =>
      streamSSE(c, async (stream) => {
        await stream.writeSSE({ event: "ping", data: "hello" });
      }),
    );

    const res = await app.request("/stream");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain("event: ping");
    expect(body).toContain("data: hello");
  });
});
