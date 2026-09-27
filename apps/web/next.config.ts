/**
 * @file next.config
 * @description Next.js configuration: API proxying and security headers.
 *
 * Responsibilities:
 * - Resolve the backend port from the repo-root .env
 * - Proxy same-origin /api requests to the local runtime
 * - Apply site-wide security headers (CSP)
 */

import fs from "node:fs";
import path from "node:path";

import type { NextConfig } from "next";

/**
 * Backend port resolution: process env BACKEND_PORT > repo-root .env's BACKEND_PORT >
 * default 8281.
 *
 * The standard startup (pnpm dev) injects no env vars through any script, so this
 * reads the repo-root .env directly, keeping "edit .env's BACKEND_PORT → the frontend
 * proxy follows automatically" as one configuration source. Environments without a
 * .env (e.g. CI builds) safely fall back to 8281 via try/catch.
 *
 * Design note: next.config.ts executes at build time, so the runtime module
 * @agentprism/config cannot be used here. This file plus client/http.ts's env read
 * are the legitimate ownership points of frontend build-time configuration, not an
 * architecture violation. Backend runtime env is managed uniformly via
 * bootstrap.ts → @agentprism/config.
 */
function resolveBackendPort(): number {
  const envPort = process.env.BACKEND_PORT;
  if (envPort) {
    return Number(envPort);
  }
  const candidates = [
    // When compiled, next.config.ts sits in apps/web/: two parent levels up is the monorepo root
    path.resolve(__dirname, "..", "..", ".env"),
    // Fallback: derive from the process working directory (pnpm dev/build both run with apps/web/ as cwd)
    path.resolve(process.cwd(), "..", "..", ".env"),
  ];
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, "utf-8");
      const match = text.match(/^\s*BACKEND_PORT\s*=\s*"?([^"\s#]+)"?\s*$/m);
      if (match) {
        const port = Number(match[1]);
        if (Number.isInteger(port) && port > 0) {
          return port;
        }
      }
    } catch {
      // File missing or unreadable → try the next candidate
    }
  }
  return 8281;
}

/**
 * Security response headers — applied site-wide.
 *
 * The Content-Security-Policy is NOT here: it needs a per-request script nonce, so it
 * lives in `src/middleware.ts` (a second CSP header would be enforced in addition to
 * that one, and the intersection would block the nonced inline scripts).
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  // SSE correctness: Next's gzip compression buffers the proxied event stream and
  // flushes only when the run completes, so the Arena trace renders all at once
  // instead of step by step. Streaming responses must pass through uncompressed.
  compress: false,
  // The default bottom-left circular "N" overlaps the guide page's sticky TOC; move it bottom-right to clear the sidebar
  devIndicators: {
    position: "bottom-right",
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        // Same-origin proxy: the browser's /api/* requests are forwarded by Next.js to the backend, avoiding CORS.
        // The backend port's single configuration source = repo-root .env's BACKEND_PORT (see resolveBackendPort).
        destination: `http://127.0.0.1:${resolveBackendPort()}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  // Next.js 16 dev blocks cross-host access to dev resources by default;
  // both 127.0.0.1 and localhost access must be explicitly allowed.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
