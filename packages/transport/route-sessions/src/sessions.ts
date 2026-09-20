/**
 * @file routes/sessions
 * @description Execution-session read routes: filtered listing, query pages, detail, and export.
 *
 * Responsibilities:
 * - Register session endpoints and map to application use cases
 * - Serve telemetry reports and projection windows additively
 */

import { AppError } from "@agentprism/application";
import { SessionExportRequestSchema, type SessionKind, type SessionStatus } from "@agentprism/contracts";
import type { HttpApplicationDeps } from "@agentprism/http-runtime";
import { parseJsonBody, type HttpApp } from "@agentprism/http-runtime";

const SESSION_KINDS: readonly SessionKind[] = ["arena", "agent", "builder"];
const SESSION_STATUSES: readonly SessionStatus[] = ["active", "completed", "failed", "cancelled"];
const MAX_LIST_LIMIT = 200;
const SORT_ORDERS: readonly string[] = ["newest", "oldest", "title"];

/** Session routes: filtered listing, query pages, stats, telemetry, detail, export, and operator delete. */
export function registerSessionRoutes(app: HttpApp, deps: HttpApplicationDeps): void {
  // Registered before /:sessionId: a single-segment path would otherwise swallow "stats".
  app.get("/api/sessions/stats", async (c) => {
    try {
      return c.json(await deps.sessions.getSessionStats());
    } catch (error) {
      console.warn(`[transport] Session stats failed: ${error instanceof Error ? error.message : String(error)}`);
      throw AppError.internal("Failed to load session stats");
    }
  });

  // Registered before /:sessionId for the same path-shape reason as "stats".
  app.get("/api/sessions/telemetry", async (c) => {
    try {
      return c.text(deps.sessions.telemetryReport());
    } catch (error) {
      console.warn(`[transport] Session telemetry failed: ${error instanceof Error ? error.message : String(error)}`);
      throw AppError.internal("Failed to render session telemetry");
    }
  });

  app.get("/api/sessions", async (c) => {
    const kind = c.req.query("kind");
    const status = c.req.query("status");
    const limitRaw = c.req.query("limit");
    if (kind !== undefined && !(SESSION_KINDS as readonly string[]).includes(kind)) {
      throw AppError.badRequest(`Unknown session kind: ${kind}`);
    }
    if (status !== undefined && !(SESSION_STATUSES as readonly string[]).includes(status)) {
      throw AppError.badRequest(`Unknown session status: ${status}`);
    }
    let limit: number | undefined;
    if (limitRaw !== undefined) {
      limit = Number(limitRaw);
      if (!Number.isInteger(limit) || limit < 0) throw AppError.badRequest(`Invalid limit: ${limitRaw}`);
      limit = Math.min(limit, MAX_LIST_LIMIT);
    }
    // Advanced query (text search / sort / offset / multi-select / time windows /
    // entry text) routes through the session-query engine and returns a page
    // with totals; plain listings keep the store passthrough shape.
    const q = c.req.query("q");
    const sort = c.req.query("sort");
    const offsetRaw = c.req.query("offset");
    const kindsRaw = c.req.query("kinds");
    const statusesRaw = c.req.query("statuses");
    const createdFromRaw = c.req.query("createdFrom");
    const createdToRaw = c.req.query("createdTo");
    const updatedToRaw = c.req.query("updatedTo");
    const entryText = c.req.query("entryText");
    const advanced =
      q !== undefined || sort !== undefined || offsetRaw !== undefined ||
      kindsRaw !== undefined || statusesRaw !== undefined ||
      createdFromRaw !== undefined || createdToRaw !== undefined ||
      updatedToRaw !== undefined || entryText !== undefined;
    if (advanced) {
      if (sort !== undefined && !SORT_ORDERS.includes(sort)) {
        throw AppError.badRequest(`Unknown session sort: ${sort}`);
      }
      let offset: number | undefined;
      if (offsetRaw !== undefined) {
        offset = Number(offsetRaw);
        if (!Number.isInteger(offset) || offset < 0) throw AppError.badRequest(`Invalid offset: ${offsetRaw}`);
      }
      // The single-select kind/status stay honored inside advanced queries:
      // dropping them silently here would return wider results than asked for.
      const readTokenList = (raw: string | undefined, single: string | undefined, known: readonly string[], name: string): string[] | undefined => {
        const tokens = [
          ...(single === undefined ? [] : [single]),
          ...(raw === undefined || raw === "" ? [] : raw.split(",")),
        ].map((s) => s.trim()).filter((s) => s !== "");
        if (tokens.length === 0) return undefined;
        if (tokens.length > 10) throw AppError.badRequest(`Too many ${name} (max 10)`);
        if (tokens.some((t) => !known.includes(t))) {
          throw AppError.badRequest(`Unknown session ${name}: ${raw ?? single}`);
        }
        return [...new Set(tokens)];
      };
      const kinds = readTokenList(kindsRaw, kind, SESSION_KINDS as readonly string[], "kinds") as SessionKind[] | undefined;
      const statuses = readTokenList(statusesRaw, status, SESSION_STATUSES as readonly string[], "statuses") as SessionStatus[] | undefined;
      const readEpoch = (raw: string | undefined, name: string): number | undefined => {
        if (raw === undefined || raw === "") return undefined;
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 0) throw AppError.badRequest(`Invalid ${name}: ${raw}`);
        return value;
      };
      const createdFrom = readEpoch(createdFromRaw, "createdFrom");
      const createdTo = readEpoch(createdToRaw, "createdTo");
      const updatedTo = readEpoch(updatedToRaw, "updatedTo");
      if (entryText !== undefined && entryText.length > 500) {
        throw AppError.badRequest("entryText too long (max 500 chars)");
      }
      try {
        const page = await deps.sessions.searchSessions({
          ...(q === undefined || q === "" ? {} : { text: q }),
          ...(sort === undefined ? {} : { sort: sort as "newest" | "oldest" | "title" }),
          ...(limit === undefined ? {} : { limit }),
          ...(offset === undefined ? {} : { offset }),
          ...(kinds === undefined ? {} : { kinds }),
          ...(statuses === undefined ? {} : { statuses }),
          ...(createdFrom === undefined ? {} : { createdFrom }),
          ...(createdTo === undefined ? {} : { createdTo }),
          ...(updatedTo === undefined ? {} : { updatedTo }),
          ...(entryText === undefined || entryText === "" ? {} : { entryText }),
        });
        return c.json({ sessions: page.rows, total: page.total, limit: page.limit, offset: page.offset });
      } catch (error) {
        if (error instanceof AppError) throw error;
        console.warn(`[transport] Session list failed: ${error instanceof Error ? error.message : String(error)}`);
        throw AppError.internal("Failed to list sessions");
      }
    }
    try {
      const sessions = await deps.sessions.listSessions({
        ...(kind === undefined ? {} : { kind: kind as SessionKind }),
        ...(status === undefined ? {} : { status: status as SessionStatus }),
        ...(limit === undefined ? {} : { limit }),
      });
      return c.json({ sessions });
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.warn(`[transport] Session list failed: ${error instanceof Error ? error.message : String(error)}`);
      throw AppError.internal("Failed to list sessions");
    }
  });

  app.get("/api/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const limitRaw = c.req.query("limit");
    const offsetRaw = c.req.query("offset");
    let window: { limit: number; offset: number } | undefined;
    if (limitRaw !== undefined || offsetRaw !== undefined) {
      let limit = 50;
      if (limitRaw !== undefined) {
        limit = Number(limitRaw);
        if (!Number.isInteger(limit) || limit < 1) throw AppError.badRequest(`Invalid limit: ${limitRaw}`);
        limit = Math.min(limit, 500);
      }
      let offset = 0;
      if (offsetRaw !== undefined) {
        offset = Number(offsetRaw);
        if (!Number.isInteger(offset) || offset < 0) throw AppError.badRequest(`Invalid offset: ${offsetRaw}`);
      }
      window = { limit, offset };
    }
    let found: Awaited<ReturnType<typeof deps.sessions.getSession>>;
    try {
      found = await deps.sessions.getSession(sessionId, window);
    } catch (error) {
      console.warn(`[transport] Session detail failed: ${error instanceof Error ? error.message : String(error)}`);
      throw AppError.internal("Failed to load session");
    }
    if (found === null) throw AppError.notFound("Session not found");
    return c.json(found);
  });

  app.post("/api/sessions/export", async (c) => {
    // Size-guarded streaming read (never c.req.json(): chunked bodies without
    // Content-Length would bypass the limit until memory is exhausted).
    const body = await parseJsonBody(c, SessionExportRequestSchema);
    try {
      const documents = await deps.sessions.exportSessions(body.ids);
      return c.json({ documents });
    } catch (error) {
      console.warn(`[transport] Session batch export failed: ${error instanceof Error ? error.message : String(error)}`);
      throw AppError.internal("Failed to export sessions");
    }
  });

  app.get("/api/sessions/:sessionId/export", async (c) => {
    const sessionId = c.req.param("sessionId");
    let exported: Awaited<ReturnType<typeof deps.sessions.exportSession>>;
    try {
      exported = await deps.sessions.exportSession(sessionId);
    } catch (error) {
      console.warn(`[transport] Session export failed: ${error instanceof Error ? error.message : String(error)}`);
      throw AppError.internal("Failed to export session");
    }
    if (exported === null) throw AppError.notFound("Session not found");
    // The service stamps exportedAt from the injected clock; the format version
    // is the current session-format envelope so restores route through the migrator.
    c.header("Content-Disposition", `attachment; filename="session-${sessionId}.json"`);
    return c.json(exported);
  });

  app.delete("/api/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    let deleted: boolean;
    try {
      deleted = await deps.sessions.deleteSession(sessionId);
    } catch (error) {
      console.warn(`[transport] Session delete failed: ${error instanceof Error ? error.message : String(error)}`);
      throw AppError.internal("Failed to delete session");
    }
    if (!deleted) throw AppError.notFound("Session not found");
    return c.json({ deleted: sessionId });
  });
}
