/**
 * @file routes/arena
 * @description Arena experiment routes: metadata, SSE run stream, templates, judging.
 *
 * Responsibilities:
 * - Register arena endpoints and map results onto responses and event streams
 */

import type { HttpApplicationDeps } from "@agentprism/http-runtime";
import { ArenaAnswerRequestSchema, ArenaRunRequestSchema, ArenaStopColumnRequestSchema, JudgeRequestSchema, MatrixRequestSchema, systemErrorEvent, sanitizeErrorMessage } from "@agentprism/contracts";
import { streamSSE } from "hono/streaming";
import { parseJsonBody, settingsOf, type HttpApp } from "@agentprism/http-runtime";

/** Arena experiment-domain routes: metadata / SSE run stream / templates / judging. */
export function registerArenaRoutes(app: HttpApp, deps: HttpApplicationDeps): void {
  app.get("/api/arena/meta", async (c) => c.json(await deps.arena.getMeta()));

  app.post("/api/arena/answer", async (c) => {
    const request = await parseJsonBody(c, ArenaAnswerRequestSchema);
    await deps.arena.answerQuestion(request.agent_id, request.question_id, request.answer);
    return c.json({ ok: true });
  });

  app.get("/api/arena/pending-asks", async (c) => c.json({ pending: await deps.arena.pendingAsks() }));

  // Per-column observability logs for the logs/wire comparison page. Safe while a
  // run streams: this only reads the JSONL tails the runner appends fail-open.
  app.get("/api/arena/column-logs", (c) => {
    const workspace = c.req.query("workspace") ?? "";
    const label = c.req.query("label") ?? "";
    if (workspace === "" || label === "") {
      return c.json({ detail: "workspace and label query parameters are required" }, 400);
    }
    return c.json(deps.arenaLogs.columnLogs(workspace, label));
  });

  app.post("/api/arena/stop-column", async (c) => {
    const request = await parseJsonBody(c, ArenaStopColumnRequestSchema);
    await deps.arena.stopColumn(request.agent_id);
    return c.json({ ok: true });
  });

  app.post("/api/arena/run", async (c) => {
    const request = await parseJsonBody(c, ArenaRunRequestSchema);
    const abortController = new AbortController();
    return streamSSE(c, async (stream) => {
      stream.onAbort(() => abortController.abort());
      // Idle-stream keepalive: columns waiting on a human answer (ask_user) emit
      // nothing for a while; comment lines keep middle proxies from dropping the
      // connection and are ignored by every conforming SSE parser.
      const heartbeat = setInterval(() => {
        if (!abortController.signal.aborted) {
          void stream.write(": ping\n\n").catch(() => undefined);
        }
      }, settingsOf(c).sseHeartbeatMs);
      try {
        for await (const event of deps.arena.run(request, { signal: abortController.signal })) {
          if (abortController.signal.aborted) break;
          await stream.writeSSE({ event: "arena", data: JSON.stringify(event) });
        }
      } catch (error) {
        // In-stream exceptions must be visible to the client: delivered via the business-error channel, never a silent stream close.
        // Guarded: the stream may already be dead when the client disconnected mid-run.
        if (!abortController.signal.aborted) {
          try {
            await stream.writeSSE({
              event: "arena",
              data: JSON.stringify(systemErrorEvent(sanitizeErrorMessage(error), deps.clock.now())),
            });
          } catch {
            // Client is gone; the original error is already recorded upstream.
          }
        }
      } finally {
        clearInterval(heartbeat);
      }
    });
  });

  app.get("/api/arena/templates", (c) => c.json({ templates: deps.arena.listTemplates() }));

  app.post("/api/arena/judge", async (c) => {
    const body = await parseJsonBody(c, JudgeRequestSchema);
    return c.json(deps.arena.judge(body.template_id, body.answers));
  });

  app.post("/api/arena/judge-async", async (c) => {
    const body = await parseJsonBody(c, JudgeRequestSchema);
    return c.json(await deps.arena.judgeAsync(body.template_id, body.answers));
  });

  app.post("/api/arena/matrix", async (c) => {
    const request = await parseJsonBody(c, MatrixRequestSchema);
    const abortController = new AbortController();
    return streamSSE(c, async (stream) => {
      stream.onAbort(() => abortController.abort());
      // Long matrices run cells sequentially; keep middle proxies from dropping
      // the silent stream (same keepalive as the run/chat SSE paths).
      const heartbeat = setInterval(() => {
        if (!abortController.signal.aborted) {
          void stream.write(": ping\n\n").catch(() => undefined);
        }
      }, settingsOf(c).sseHeartbeatMs);
      try {
        for await (const item of deps.matrix.runMatrix(request.cells, { signal: abortController.signal })) {
          if (abortController.signal.aborted) break;
          if (item.kind === "report") {
            await stream.writeSSE({ event: "matrix", data: JSON.stringify({ type: "matrix_report", report: item.report }) });
          } else {
            await stream.writeSSE({ event: "matrix", data: JSON.stringify({ type: "matrix_progress", ...item }) });
          }
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          try {
            await stream.writeSSE({
              event: "matrix",
              data: JSON.stringify(systemErrorEvent(sanitizeErrorMessage(error), deps.clock.now())),
            });
          } catch {
            // Client is gone; the original error is already recorded upstream.
          }
        }
      } finally {
        clearInterval(heartbeat);
      }
    });
  });
}
