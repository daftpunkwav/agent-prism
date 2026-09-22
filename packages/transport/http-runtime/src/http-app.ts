/**
 * @file http-app
 * @description HTTP transport shell: middleware, health checks, error mapping.
 *
 * Responsibilities:
 * - Keep middleware and health checks; expose the composed-app shell
 * - Map application errors and serialize events onto responses
 *
 * Domain routes live in the route-* leaves and are mounted by the composition
 * root (apps/server); this shell never imports them (no runtime cycle).
 *
 * Protocol only: never listens on ports, creates drivers, or reads storage —
 * port ownership belongs to apps/server (owns listen/serve).
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { Clock } from "@agentprism/contracts";
import { sanitizeErrorMessage } from "@agentprism/contracts";
import { buildCorsOriginList, type RuntimeKnobFieldMeta, type RuntimeKnobs, type Settings } from "@agentprism/config";
import { AppError, type ArenaLogsService, type ArenaService, type MatrixService, type ProviderService, type ProjectStore, type SessionService, type ThreadService, type WorkspaceFileService } from "@agentprism/application";
import { BuilderError, type BuilderService } from "@agentprism/builder-service";
import { assertBodySize, type HttpApp } from "./route-plumbing.js";

/** Live runtime-knob controller backing the settings/knobs routes (composition root provides). */
export interface RuntimeKnobsController {
  current(): RuntimeKnobs;
  /** Field metadata (group/kind/range/options/defaults) for settings UI rendering. */
  fields(): readonly RuntimeKnobFieldMeta[];
  update(raw: unknown): Promise<RuntimeKnobs>;
}

/** Skill management controller backing the settings/skills routes (composition root provides). */
export interface SkillsController {
  list(): Array<{ name: string; description: string; source: string; enabled: boolean }>;
  create(input: { name: string; description: string; body: string }): { name: string };
  update(name: string, patch: { description?: string; body?: string }): { name: string };
  remove(name: string): void;
  setEnabled(name: string, enabled: boolean): void;
}

/** Managed MCP server list controller backing the settings/mcp routes. */
export interface McpController {
  list(): ReadonlyArray<Record<string, unknown>>;
  /** Full-list replace; throws McpStoreError-shaped Errors on invalid input. */
  replace(input: unknown): ReadonlyArray<Record<string, unknown>>;
}

/** Memory store status snapshot + maintenance action. */
export interface MemoryStatusController {
  status(): { episodicCount: number; semanticCount: number; episodicPath: string; semanticPath: string };
  clear(): void;
}

export interface HttpApplicationDeps {
  settings: Settings;
  arena: ArenaService;
  /** Read side of the per-run column observability logs (events + LLM wire). */
  arenaLogs: ArenaLogsService;
  matrix: MatrixService;
  providers: ProviderService;
  workspaces: WorkspaceFileService;
  projects: ProjectStore;
  builder: BuilderService;
  sessions: SessionService;
  threads: ThreadService;
  clock: Clock;
  /** Runtime knob controller (absent = knobs routes not registered). */
  runtimeKnobs?: RuntimeKnobsController;
  /** Memory status controller (absent = memory routes not registered). */
  memoryStatus?: MemoryStatusController;
  /** Skill management controller (absent = skills routes not registered). */
  skills?: SkillsController;
  /** Managed MCP server list controller (absent = mcp routes not registered). */
  mcp?: McpController;
}

/**
 * Constant-time token comparison: SHA-256 digests compared via timingSafeEqual
 * so the request-boundary check does not leak token content or length through
 * an early-exit string compare (the server may be exposed on the LAN).
 * Digest equality is equivalent to string equality (collision-resistant hash),
 * and fixed-length digests sidestep timingSafeEqual's equal-length requirement.
 */
function tokensMatch(presented: string, expected: string): boolean {
  const presentedDigest = createHash("sha256").update(presented, "utf-8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf-8").digest();
  return timingSafeEqual(presentedDigest, expectedDigest);
}

/** API token auth: /api/health and /health are exempt. */
function apiTokenMiddleware(token: string): MiddlewareHandler {
  return async (c, next) => {
    if (token === "") return next();
    const path = new URL(c.req.url).pathname;
    if (path === "/api/health" || path === "/health") return next();
    const authorization = c.req.header("Authorization") ?? "";
    const headerToken = c.req.header("X-API-Token") ?? "";
    const bearerMatch = /^bearer\s+(.+)$/i.exec(authorization);
    const presented = bearerMatch?.[1]?.trim() ?? "";
    if (tokensMatch(presented, token) || tokensMatch(headerToken, token)) return next();
    return c.json({ detail: "Unauthorized: a valid API Token is required" }, 401);
  };
}

/**
 * Builds the HTTP shell: protocol parsing, middleware, health checks, error
 * mapping, and event serialization only. Domain routes are mounted by the caller
 * (see route-* leaves); this file does not listen on ports, create drivers, or
 * read databases — port ownership belongs to apps/server (owns listen/serve).
 */
export function createHttpApplication(deps: HttpApplicationDeps): HttpApp {
  const { settings } = deps;
  const app = new Hono<{ Variables: { appSettings: Settings } }>();

  // CORS: allowlist + credentials
  app.use(
    "*",
    cors({
      origin: buildCorsOriginList(settings.corsOrigins, settings.frontendPort),
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-API-Token"],
    }),
  );

  // Request size precheck (Content-Length) + auth
  app.use("*", async (c, next) => {
    c.set("appSettings", settings);
    const contentLength = c.req.header("Content-Length");
    if (contentLength !== undefined) {
      const size = Number(contentLength);
      if (!Number.isFinite(size)) {
        return c.json({ detail: "Invalid Content-Length header" }, 400);
      }
      assertBodySize(size, settings);
    }
    await next();
  });
  app.use("*", apiTokenMiddleware(settings.apiToken));

  const health = (c: Context) => c.json({ status: "ok", service: "arena" });
  app.get("/api/health", health);
  app.get("/health", health);

  // ===== error mapping =====
  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json({ detail: error.detail }, error.status as 400 | 401 | 404 | 413 | 422 | 500);
    }
    if (error instanceof BuilderError) {
      return c.json({ detail: error.detail }, error.status as 400 | 401 | 404 | 413 | 422 | 500);
    }
    return c.json({ detail: sanitizeErrorMessage(error) }, 500);
  });

  return app;
}
