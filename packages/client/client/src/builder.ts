/**
 * @file builder client
 * @description Browser API client for the Agent Builder routes.
 *
 * Responsibilities:
 * - Block catalog, session CRUD, and hot-swap calls
 * - SSE chat streaming (trace entries + arena events + turn meta) with abort support
 *
 * Thin transport only: no state, no retry policy, no UI concerns.
 */

import { API_BASE, ApiError, apiFetch, isAbortError, responseDetail } from "./http.js";
import { pumpSSEBlocks } from "./sse.js";
import { defaultBuilderComposition } from "@agentprism/contracts";
import type {
  BuilderCatalog,
  BuilderCreateRequest,
  BuilderPatchRequest,
  BuilderSessionDetail,
  BuilderSessionView,
  BuilderStreamChunk,
  BuilderSwapResult,
  RunAttachment,
} from "@agentprism/contracts";

/** Factory-default composition (contracts single source), re-exported for UI restore-default. */
export { defaultBuilderComposition };

/** Fetches the block palette (frameworks / endpoints / tools / capabilities). */
export async function fetchBuilderCatalog(options?: { signal?: AbortSignal }): Promise<BuilderCatalog> {
  const res = await apiFetch(`${API_BASE}/api/builder/catalog`, {
    cache: "no-store",
    signal: options?.signal,
  });
  if (!res.ok) throw new ApiError("Failed to load builder catalog", "http", res.status);
  return res.json();
}

/** Lists all builder sessions (oldest first). */
export async function fetchBuilderSessions(options?: { signal?: AbortSignal }): Promise<BuilderSessionView[]> {
  const res = await apiFetch(`${API_BASE}/api/builder/sessions`, {
    cache: "no-store",
    signal: options?.signal,
  });
  if (!res.ok) throw new ApiError("Failed to load builder sessions", "http", res.status);
  const payload = (await res.json()) as { sessions: BuilderSessionView[] };
  return payload.sessions;
}

/** Creates a session; returns its view. */
export async function createBuilderSession(body: BuilderCreateRequest): Promise<BuilderSessionView> {
  const res = await apiFetch(`${API_BASE}/api/builder/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Failed to create session"), "http", res.status);
  return res.json();
}

/** Fetches one session with its trace log. */
export async function fetchBuilderSessionDetail(
  id: string,
  options?: { signal?: AbortSignal },
): Promise<BuilderSessionDetail> {
  const res = await apiFetch(`${API_BASE}/api/builder/sessions/${encodeURIComponent(id)}`, {
    cache: "no-store",
    signal: options?.signal,
  });
  if (!res.ok) throw new ApiError("Failed to load builder session", "http", res.status);
  return res.json();
}

/** Hot-swaps composition blocks between turns; returns the swap diff. */
export async function patchBuilderComposition(id: string, body: BuilderPatchRequest): Promise<BuilderSwapResult> {
  const res = await apiFetch(`${API_BASE}/api/builder/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Hot-swap failed"), "http", res.status);
  return res.json();
}

/** Deletes a session. */
export async function deleteBuilderSession(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/builder/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Failed to delete session"), "http", res.status);
}

/** Aborts the in-flight turn; returns whether one was running. */
export async function abortBuilderTurn(id: string): Promise<boolean> {
  const res = await apiFetch(`${API_BASE}/api/builder/sessions/${encodeURIComponent(id)}/abort`, {
    method: "POST",
  });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Abort failed"), "http", res.status);
  const payload = (await res.json()) as { aborted: boolean };
  return payload.aborted;
}

/** Delivers the human's answer to the session's pending ask_user question. */
export async function answerBuilderQuestion(id: string, questionId: string, answer: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/builder/sessions/${encodeURIComponent(id)}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question_id: questionId, answer }),
  });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Failed to deliver answer"), "http", res.status);
}

/** Named options for streamBuilderChat (avoids a long positional parameter list). */
export interface StreamBuilderChatOptions {
  sessionId: string;
  message: string;
  attachments?: RunAttachment[];
  /** UI locale tag steering the agent's reply language (arena parity). */
  language?: string;
  onChunk: (chunk: BuilderStreamChunk) => void;
  signal?: AbortSignal;
  onParseError?: (raw: string, err: Error) => void;
}

/**
 * Streams one builder chat turn.
 *
 * SSE notes mirror streamArenaRun: ``data: <json>`` payloads are forwarded to
 * onChunk, ``data: [DONE]`` ends silently, and parse failures go to onParseError.
 */
export async function streamBuilderChat(options: StreamBuilderChatOptions): Promise<void> {
  const { sessionId, message, attachments, language, onChunk, signal, onParseError } = options;
  let res: Response;
  try {
    res = await apiFetch(`${API_BASE}/api/builder/sessions/${encodeURIComponent(sessionId)}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        message,
        ...(attachments === undefined ? {} : { attachments }),
        ...(language === undefined ? {} : { language }),
      }),
      signal,
      timeout: false, // SSE long connection: no timeout
    });
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) return;
    throw err;
  }

  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new ApiError(text || "Builder chat failed", "http", res.status);
  }

  // Shared pump: gains tail-block parsing, decoder flush, and abort-silence over the
  // previous inline loop (a final block closed by connection end was dropped, and a
  // mid-read abort propagated instead of ending silently).
  await pumpSSEBlocks(
    res,
    (json) => {
      if (json === "[DONE]") return;
      let parsed: BuilderStreamChunk;
      try {
        parsed = JSON.parse(json) as BuilderStreamChunk;
      } catch (err) {
        if (onParseError) onParseError(json, err as Error);
        return;
      }
      onChunk(parsed);
    },
    signal,
  );
}

