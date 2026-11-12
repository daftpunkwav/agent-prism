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

/**
 * Reads a positive-integer millisecond override.
 *
 * The whole string must be digits: `Number.parseInt` reads a leading prefix, so
 * `1e5` would silently become 1 ms (and `30000ms` would pass as 30000), turning
 * a typo into a confusing readiness failure. An invalid value fails fast instead
 * of flowing into the deadline math at all.
 */
function positiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const text = raw.trim();
  const value = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value <= 0) {
    console.error(`[smoke] invalid ${name}=${JSON.stringify(raw)}; expected a positive integer (milliseconds)`);
    process.exit(1);
  }
  return value;
}

const READY_TIMEOUT_MS = positiveIntEnv("SMOKE_TIMEOUT_MS", 30_000);
const REQUEST_TIMEOUT_MS = positiveIntEnv("SMOKE_REQUEST_TIMEOUT_MS", 5_000);
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

/**
 * Framework ids the built host must register when DRIVERS does not narrow the set.
 * Registration is best-effort (a backend that fails to load only warns), so this
 * check is what catches a driver package silently dropping out of the built
 * composition — a missing runtime dependency, for instance, would otherwise leave
 * the column missing while every other probe still passes.
 */
const EXPECTED_FRAMEWORK_IDS = [
  "native",
  "plan_execute",
  "self_critique",
  "langchain",
  "langgraph",
  "deepagents",
  "openai_agents",
  "claude_agent_sdk",
  "autogen",
  "crewai",
];

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
      // An operator-narrowed DRIVERS allowlist legitimately serves fewer backends;
      // only the unrestricted composition is pinned here.
      if ((process.env.DRIVERS ?? "").trim() !== "") return null;
      const registered = new Set(body.frameworks.map((framework) => framework?.id));
      const missing = EXPECTED_FRAMEWORK_IDS.filter((id) => !registered.has(id));
      if (missing.length > 0) {
        return `backends missing from the built composition: ${missing.join(", ")} ` +
          `(registered: ${[...registered].join(", ")})`;
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
    // exitCode rather than process.exit: an immediate exit while HTTP sockets are
    // still draining aborts libuv on Windows and buries the summary above under an
    // assertion. Setting the code lets the loop finish and the process end cleanly.
    process.exitCode = 1;
    return;
  }
  console.log(`[smoke] ok: ${checks.length}/${checks.length} checks passed`);
}

await main();
