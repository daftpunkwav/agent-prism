/**
 * @file routes/threads
 * @description Agent thread routes: durable fork/resume threads with an SSE run stream.
 *
 * Responsibilities:
 * - Register thread endpoints (create/list/detail/fork/run/delete)
 * - Map thread runs onto the SSE stream shape (heartbeat, abort, in-stream errors) under `event: thread`
 */

import type { HttpApplicationDeps } from "@agentprism/http-runtime";
import { ThreadCreateRequestSchema, ThreadForkRequestSchema, ThreadRunRequestSchema, systemErrorEvent, sanitizeErrorMessage } from "@agentprism/contracts";
import { streamSSE } from "hono/streaming";
import { parseJsonBody, settingsOf, type HttpApp } from "@agentprism/http-runtime";

/** Thread-domain routes: lifecycle plus the SSE resume-run stream. */
export function registerThreadRoutes(app: HttpApp, deps: HttpApplicationDeps): void {
  app.get("/api/threads", (c) => c.json({ threads: deps.threads.list() }));

  app.post("/api/threads", async (c) => {
    const request = await parseJsonBody(c, ThreadCreateRequestSchema);
    return c.json(deps.threads.create(request));
  });

  app.get("/api/threads/:threadId", (c) => c.json(deps.threads.getDetail(c.req.param("threadId"))));

  app.delete("/api/threads/:threadId", (c) => {
    const deleted = deps.threads.deleteThread(c.req.param("threadId"));
    return c.json({ deleted: deleted.id });
  });

  app.post("/api/threads/:threadId/fork", async (c) => {
    const request = await parseJsonBody(c, ThreadForkRequestSchema);
    return c.json(await deps.threads.fork(c.req.param("threadId"), request));
  });

  // Resume as SSE: the arena stream mechanics (heartbeat keepalive, abort propagation,
  // in-stream error events) under the thread-owned `event: thread` channel name.
  app.post("/api/threads/:threadId/run", async (c) => {
    const threadId = c.req.param("threadId");
    const request = await parseJsonBody(c, ThreadRunRequestSchema);
    // Conflict/404 surface as HTTP status codes, not in-stream error events.
    deps.threads.assertIdle(threadId);
    const abortController = new AbortController();
    return streamSSE(c, async (stream) => {
      stream.onAbort(() => abortController.abort());
      // Same idle-stream keepalive as the arena stream: middle proxies must not
      // drop a quiet connection (ask_user waits), and comment lines are ignored
      // by every conforming SSE parser.
      const heartbeat = setInterval(() => {
        if (!abortController.signal.aborted) {
          void stream.write(": ping\n\n").catch(() => undefined);
        }
      }, settingsOf(c).sseHeartbeatMs);
      try {
        for await (const event of deps.threads.run(threadId, request, { signal: abortController.signal })) {
          if (abortController.signal.aborted) break;
          await stream.writeSSE({ event: "thread", data: JSON.stringify(event) });
        }
      } catch (error) {
        // In-stream exceptions must reach the client through the business-error
        // channel; guarded because the stream may already be dead on disconnect.
        if (!abortController.signal.aborted) {
          try {
            await stream.writeSSE({
              event: "thread",
              data: JSON.stringify(systemErrorEvent(sanitizeErrorMessage(error), deps.clock.now())),
            });
          } catch {
            // Client is gone; the error state is already committed by the service.
          }
        }
      } finally {
        clearInterval(heartbeat);
      }
    });
  });
}
