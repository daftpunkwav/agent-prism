/**
 * @file middleware
 * @description Per-request Content-Security-Policy carrying a script nonce.
 *
 * Responsibilities:
 * - Mint a per-request nonce and build the CSP header for document responses
 * - Publish the nonce on `x-nonce` so app-rendered pre-paint scripts can carry it
 * - Skip static assets and the /api proxy (SSE responses must stream untouched)
 *
 * Production cannot use `script-src 'self'`: Next inlines its own flight/bootstrap
 * scripts and the app inlines the theme/skin/locale pre-paint scripts, so a nonce is
 * the only workable tightening (hashes cannot cover the per-page flight payload).
 * Next reads the nonce back out of the request's CSP header and stamps it onto every
 * script it injects; app-rendered scripts read `x-nonce`. Dev keeps the hot-reload
 * allowances. A direct cross-origin backend (`NEXT_PUBLIC_API_BASE`) must be added to
 * `connect-src`, or REST and SSE requests are silently blocked.
 */

import { NextResponse, type NextRequest } from "next/server";

const isProd = process.env.NODE_ENV === "production";

/** Site-wide CSP for document responses. */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    isProd
      ? `script-src 'self' 'nonce-${nonce}'`
      : `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function middleware(request: NextRequest): NextResponse {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = contentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Static assets and the /api proxy need no CSP; SSE responses must stream untouched.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
