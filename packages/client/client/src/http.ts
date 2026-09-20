/**
 * @file http
 * @description Shared fetch plumbing with a unified error taxonomy.
 *
 * Responsibilities:
 * - Own the single env read point for the client package (API_BASE)
 * - Classify failures into the ApiError taxonomy
 * - Apply timeout handling in apiFetch
 * - Recognize user-initiated aborts (isAbortError)
 */


/**
 * Client API base address (inlined at Next.js build time).
 *
 * This is the client package's only env read point — NEXT_PUBLIC_* variables are
 * replaced by Next.js at build time and cannot be injected via the runtime
 * @agentprism/config module, so this is the legitimate single source of frontend
 * env ownership.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

/**
 * Unified network error type so the UI can distinguish "backend unreachable" from
 * "business error".
 * - kind="network": connection failure (backend down / not started)
 * - kind="http": HTTP non-2xx (business error)
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly kind: "network" | "http" = "http",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Default timeout for non-streaming requests (ms); callers pass timeout:false to disable (SSE and other long connections). */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Extended apiFetch options: timeout overrides the default; false disables timeouts entirely. */
export type ApiFetchOptions = RequestInit & { timeout?: number | false };

/**
 * Unified fetch wrapper: network failures become ApiError(kind="network"); HTTP
 * non-2xx becomes ApiError(kind="http") (thrown at call sites via res.ok).
 * A default timeout guards against a hung backend pinning the caller's UI state
 * forever; streaming endpoints must disable it explicitly.
 *
 * User-initiated cancellation (AbortError) passes through unwrapped, never disguised
 * as a network error.
 */
export async function apiFetch(url: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { timeout, signal, ...rest } = options;
  let effective: AbortSignal | null | undefined = signal;
  let timeoutSignal: AbortSignal | null = null;
  if (timeout !== false) {
    timeoutSignal = AbortSignal.timeout(typeof timeout === "number" ? timeout : DEFAULT_TIMEOUT_MS);
    // engines >= 20.9 guarantees AbortSignal.any (Node 20.3+); failing loudly beats silently giving up the timeout when missing
    effective = effective ? AbortSignal.any([effective, timeoutSignal]) : timeoutSignal;
  }
  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: effective });
  } catch (err) {
    // User-initiated cancellation passes through so callers can distinguish it; check the user signal first so cancellation wins over timeout classification
    if (signal?.aborted && isAbortError(err)) throw err;
    // AbortSignal.timeout's abort reason is a DOMException with name="TimeoutError";
    // isAbortError only recognizes "AbortError", so it cannot be used to detect timeouts
    if (isAbortError(err) || (timeoutSignal !== null && timeoutSignal.aborted)) throw new ApiError("Request timed out", "network");
    throw new ApiError("Unable to connect to the server; check that the backend is running", "network");
  }
  return res;
}

/**
 * Extracts the backend detail from a non-2xx response so limit/validation errors
 * reach the user directly; falls back when the body is not JSON or lacks detail.
 */
export async function responseDetail(res: Response, fallback: string): Promise<string> {
  try {
    const payload = (await res.json()) as { detail?: unknown };
    if (typeof payload?.detail === "string" && payload.detail !== "") return payload.detail;
  } catch {
    // Non-JSON error body; the caller-supplied fallback applies.
  }
  return fallback;
}

/** Whether the error is a user-initiated cancellation (fetch / ReadableStream abort). */
export function isAbortError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name: unknown }).name) : "";
  if (name === "AbortError") return true;
  // Chromium: BodyStreamBuffer was aborted
  const message = "message" in err ? String((err as { message: unknown }).message) : "";
  return /aborted|BodyStreamBuffer/i.test(message);
}

