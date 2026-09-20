/**
 * @file smoke
 * @description Post-deploy smoke probe for a running Agent Prism server.
 *
 * Responsibilities:
 * - Wait for the process to answer within a bounded window
 * - Probe the read-only core contracts: health, sessions, arena meta
 * - Exit non-zero with a per-check summary, so CI and release checklists can gate
 *
 * Reads only: no run is started and nothing is written.
 *
 * Usage:
 *   node scripts/smoke.mjs
 *   SMOKE_BASE_URL=http://127.0.0.1:8291 node scripts/smoke.mjs
 *   SMOKE_TIMEOUT_MS=60000 SMOKE_API_TOKEN=secret node scripts/smoke.mjs
 */

const BASE_URL = (
  process.env.SMOKE_BASE_URL ??
  `http://${process.env.SMOKE_HOST ?? "127.0.0.1"}:${process.env.SMOKE_PORT ?? "8281"}`
).replace(/\/+$/, "");
const READY_TIMEOUT_MS = Number.parseInt(process.env.SMOKE_TIMEOUT_MS ?? "30000", 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.SMOKE_REQUEST_TIMEOUT_MS ?? "5000", 10);
const READY_POLL_MS = 500;
const API_TOKEN = process.env.SMOKE_API_TOKEN ?? "";

/** GET with a hard per-request deadline; returns the status and the parsed JSON body. */
async function getJson(path) {
  const headers = API_TOKEN === "" ? {} : { Authorization: `Bearer ${API_TOKEN}` };
  const response = await fetch(`${BASE_URL}${path}`, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls the server until it answers at all, or the window closes. Any HTTP status
 * counts as reachable: a 401 is a token problem the checks should report verbatim,
 * not a boot failure.
 */
async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = "no attempt made";
  for (;;) {
    try {
      const { status } = await getJson("/health");
      return status < 500 ? null : `/health returned ${status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() >= deadline) {
      return `unreachable after ${READY_TIMEOUT_MS}ms: ${lastError}`;
    }
    await sleep(READY_POLL_MS);
  }
}

/** Each check returns null on success, or the failure message. */
const checks = [
  [
    "GET /health",
    async () => {
      const { status, body } = await getJson("/health");
      if (status !== 200) return `expected 200, got ${status}`;
      if (body?.status !== "ok" || body?.service !== "arena") {
        return `unexpected body: ${JSON.stringify(body)}`;
      }
      return null;
    },
  ],
  [
    "GET /api/sessions",
    async () => {
      const { status, body } = await getJson("/api/sessions");
      if (status !== 200) return `expected 200, got ${status}`;
      if (!Array.isArray(body?.sessions)) {
        return `missing sessions array: ${JSON.stringify(body)}`;
      }
      return null;
    },
  ],
  [
    "GET /api/arena/meta",
    async () => {
      const { status, body } = await getJson("/api/arena/meta");
      if (status !== 200) return `expected 200, got ${status}`;
      if (!Array.isArray(body?.dimensions) || !Array.isArray(body?.frameworks)) {
        return `missing dimensions/frameworks: ${JSON.stringify(body)}`;
      }
      return null;
    },
  ],
];

async function main() {
  console.log(`[smoke] target ${BASE_URL}`);
  const readyFailure = await waitForReady();
  if (readyFailure !== null) {
    console.error(`[smoke] FAIL: server ${readyFailure}`);
    process.exit(1);
  }

  const failed = [];
  for (const [name, run] of checks) {
    let failure = null;
    try {
      failure = await run();
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (failure === null) {
      console.log(`[smoke] PASS: ${name}`);
    } else {
      console.error(`[smoke] FAIL: ${name}: ${failure}`);
      failed.push(name);
    }
  }

  if (failed.length > 0) {
    console.error(`[smoke] ${failed.length} check(s) failed: ${failed.join(", ")}`);
    process.exit(1);
  }
  console.log(`[smoke] ok: ${checks.length}/${checks.length} checks passed`);
}

await main();
