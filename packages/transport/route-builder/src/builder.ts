/**
 * @file routes/builder
 * @description Agent Builder routes: catalog, session CRUD, hot-swap, chat SSE.
 *
 * Responsibilities:
 * - Register builder endpoints and map results onto responses and event streams
 * - Deliver chat turns as SSE chunks (trace entries + arena events + turn meta)
 *
 * Protocol only: conflict/validation errors map onto HTTP semantics; in-stream
 * failures travel as fatal error chunks, never as silent stream closes.
 */

import type { HttpApplicationDeps } from "@agentprism/http-runtime";
import {
  BuilderAnswerRequestSchema,
  BuilderChatRequestSchema,
  BuilderCreateRequestSchema,
  BuilderPatchRequestSchema,
} from "@agentprism/contracts";
import { BuilderError } from "@agentprism/builder-service";
import { sanitizeErrorMessage } from "@agentprism/contracts";
import { streamSSE } from "hono/streaming";
import { parseJsonBody, settingsOf, type HttpApp } from "@agentprism/http-runtime";

const STREAM_DONE = "[DONE]";

/** Builder-domain routes: catalog / sessions / composition hot-swap / SSE chat. */
export function registerBuilderRoutes(app: HttpApp, deps: HttpApplicationDeps): void {
  app.get("/api/builder/catalog", (c) => c.json(deps.builder.catalog()));

  app.get("/api/builder/sessions", (c) => c.json({ sessions: deps.builder.listSessions() }));

  app.post("/api/builder/sessions", async (c) => {
    const request = await parseJsonBody(c, BuilderCreateRequestSchema);
    return c.json(deps.builder.createSession(request));
  });

  // Awaited: the detail includes the session's persisted journal (async read).
  app.get("/api/builder/sessions/:id", async (c) => c.json(await deps.builder.getSessionDetail(c.req.param("id"))));

  app.patch("/api/builder/sessions/:id", async (c) => {
    const request = await parseJsonBody(c, BuilderPatchRequestSchema);
    return c.json(deps.builder.patchComposition(c.req.param("id"), request));
  });

  app.delete("/api/builder/sessions/:id", (c) => {
    deps.builder.deleteSession(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/builder/sessions/:id/abort", (c) => {
    const aborted = deps.builder.abortTurn(c.req.param("id"));
    return c.json({ ok: true, aborted });
  });

  app.get("/api/builder/sessions/:id/pending-ask", (c) => {
    const questions = deps.builder.pendingAsk(c.req.param("id"));
    return c.json({ questions });
  });

  app.post("/api/builder/sessions/:id/answer", async (c) => {
    const request = await parseJsonBody(c, BuilderAnswerRequestSchema);
    const delivered = deps.builder.answerQuestion(c.req.param("id"), request.question_id, request.answer);
    if (!delivered) {
      // Same {detail} error shape the global onError mapping produces (arena answer route parity).
      return c.json({ detail: `No pending question ${request.question_id} for this session` }, 404);
    }
    return c.json({ ok: true });
  });

  app.post("/api/builder/sessions/:id/chat", async (c) => {
    const request = await parseJsonBody(c, BuilderChatRequestSchema);
    const abortController = new AbortController();
    return streamSSE(c, async (stream) => {
      stream.onAbort(() => abortController.abort());
      // Idle-stream keepalive: while the agent waits on a human answer (ask_user
      // channel) no business chunks flow, and middle proxies may drop a silent
      // connection. SSE comment lines are ignored by every conforming parser.
      const heartbeat = setInterval(() => {
        if (!abortController.signal.aborted) {
          void stream.write(": ping\n\n").catch(() => undefined);
        }
      }, settingsOf(c).sseHeartbeatMs);
      try {
        for await (const chunk of deps.builder.chatTurn(c.req.param("id"), request.message, {
          signal: abortController.signal,
          attachments: request.attachments,
          language: request.language,
        })) {
          if (abortController.signal.aborted) break;
          await stream.writeSSE({ event: "builder", data: JSON.stringify(chunk) });
        }
      } catch (error) {
        // In-stream exceptions must reach the client via the error channel, never a silent close.
        // Same exposure contract as the global onError mapping: BuilderError carries its
        // client-safe detail, anything else is sanitized down to the error type name.
        // Guarded: the stream may already be dead when the client disconnected mid-turn.
        if (!abortController.signal.aborted) {
          try {
            const message = error instanceof BuilderError ? error.detail : sanitizeErrorMessage(error);
            await stream.writeSSE({
              event: "builder",
              data: JSON.stringify({ stream: "error", message, fatal: true }),
            });
          } catch {
            // Client is gone; the original error is already recorded upstream.
          }
        }
      } finally {
        clearInterval(heartbeat);
        // Guarded: no DONE write to a dead stream after client disconnect (it would throw inside the stream callback).
        if (!abortController.signal.aborted) {
          try {
            await stream.writeSSE({ event: "builder", data: STREAM_DONE });
          } catch {
            // Client is gone; nothing left to deliver.
          }
        }
      }
    });
  });
}
