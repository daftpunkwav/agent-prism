/**
 * @file assemble judge-async tests
 * @description Lock the async judging wire-through for the composed runtime.
 *
 * Responsibilities:
 * - Pin that POST /api/arena/judge-async answers exactly like the sync
 *   POST /api/arena/judge on deterministic templates (the async port falls
 *   back to the sync rules instead of failing or drifting)
 * - Pin that unknown template ids 404 on both endpoints alike
 *
 * The composition root boots once in beforeAll (the 120s budget mirrors
 * assemble.test.ts): stubbing the judge would defeat the purpose, which is
 * catching wiring regressions in assemble.ts (a dropped judgeAnswersAsync
 * binding must fail here, not silently degrade LLM judging to fail-closed).
 *
 * Env scrub policy mirrors assemble.test.ts: BACKEND_HOST, API_TOKEN and
 * MCP_SERVERS are scrubbed in beforeEach and restored in afterEach.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Env scrub helpers
// ---------------------------------------------------------------------------

const SCRUBBED = ["BACKEND_HOST", "API_TOKEN", "MCP_SERVERS"] as const;
const saved: Record<string, string | undefined> = {};

function scrubEnv(): void {
  for (const key of SCRUBBED) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of SCRUBBED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

beforeEach(scrubEnv);
afterEach(() => {
  vi.restoreAllMocks();
  restoreEnv();
});

// Driver import pulls the langchain chain; mirrors the assemble boot budget.
const COMPOSITION_TIMEOUT = 120_000;

type TestApp = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };

// ---------------------------------------------------------------------------
// judge-async wire-through
// ---------------------------------------------------------------------------

describe("assemble() judge-async wiring", () => {
  let app: TestApp;

  beforeAll(async () => {
    const { assemble } = await import("../src/assemble.js");
    ({ app } = await assemble());
  }, COMPOSITION_TIMEOUT);

  /**
   * Picks the first deterministic template (skips llm/none so no model is
   * ever invoked): both endpoints must then run the same sync rules.
   */
  async function firstDeterministicTemplateId(): Promise<string> {
    const res = await app.request("/api/arena/templates");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      templates: Array<{ id: string; judge: { type: string } }>;
    };
    const template = body.templates.find((t) => t.judge.type !== "llm" && t.judge.type !== "none");
    if (template === undefined) throw new Error("No deterministic template available for the judge wire-through test");
    return template.id;
  }

  async function judge(path: string, templateId: string): Promise<unknown> {
    const res = await app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: templateId, answers: { col: "wired answer" } }),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  /**
   * Async judging on a deterministic template must equal sync judging: the
   * service falls back to the sync port, and the route exposes it. Any
   * divergence means the composition root mis-wired the AnswerJudge port.
   */
  it("answers judge-async exactly like judge on deterministic templates", async () => {
    const templateId = await firstDeterministicTemplateId();
    const [sync, asyncResult] = await Promise.all([
      judge("/api/arena/judge", templateId),
      judge("/api/arena/judge-async", templateId),
    ]);
    expect(asyncResult).toEqual(sync);
  });

  /**
   * Unknown template ids 404 on both endpoints alike: the async route must
   * share the service's not-found semantics, not mask it as a verdict.
   */
  it("404s unknown templates on both judge endpoints", async () => {
    for (const path of ["/api/arena/judge", "/api/arena/judge-async"]) {
      const res = await app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: "no-such-template", answers: {} }),
      });
      expect(res.status, path).toBe(404);
    }
  });
});
