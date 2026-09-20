/**
 * @file threads
 * @description Browser API client for the durable agent-thread routes (fork/resume).
 *
 * Responsibilities:
 * - Thread lifecycle: create, list, detail, fork, delete
 * - Streaming one resume turn through the thread SSE event shape
 *
 * Thin transport only: no state, no retry policy, no UI concerns.
 */

import { API_BASE, ApiError, apiFetch, isAbortError, responseDetail } from "./http.js";
import { pumpSSEBlocks } from "./sse.js";
import type { ArenaEvent, ThreadCreateRequest, ThreadDetail, ThreadForkRequest, ThreadRunRequest, ThreadView } from "./types.js";

/** Lists threads oldest-first (views only; fetch one for the transcript). */
export async function listThreads(signal?: AbortSignal): Promise<ThreadView[]> {
  const res = await apiFetch(`${API_BASE}/api/threads`, { cache: "no-store", signal });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Failed to load threads"), "http", res.status);
  const data = await res.json();
  return data.threads || [];
}

/** Creates a thread with a pinned config (omitted config fields take pipeline defaults). */
export async function createThread(request: ThreadCreateRequest, signal?: AbortSignal): Promise<ThreadView> {
  const res = await apiFetch(`${API_BASE}/api/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Failed to create thread"), "http", res.status);
  return res.json();
}

/** Gets one thread with its full server-held transcript. */
export async function getThread(id: string, signal?: AbortSignal): Promise<ThreadDetail> {
  const res = await apiFetch(`${API_BASE}/api/threads/${encodeURIComponent(id)}`, { cache: "no-store", signal });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Failed to load thread"), "http", res.status);
  return res.json();
}

/** Forks a thread: copies the transcript and branches the workspace; the parent stays untouched. */
export async function forkThread(id: string, request: ThreadForkRequest = {}, signal?: AbortSignal): Promise<ThreadView> {
  const res = await apiFetch(`${API_BASE}/api/threads/${encodeURIComponent(id)}/fork`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Failed to fork thread"), "http", res.status);
  return res.json();
}

/** Deletes a thread (409 while a turn is running). The workspace directory stays on disk. */
export async function deleteThread(id: string, signal?: AbortSignal): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/threads/${encodeURIComponent(id)}`, { method: "DELETE", signal });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Failed to delete thread"), "http", res.status);
}

/** Named options for streamThreadRun. */
export interface StreamThreadRunOptions {
  threadId: string;
  question: string;
  onEvent: (event: ArenaEvent) => void;
  signal?: AbortSignal;
  onParseError?: (raw: string, err: Error) => void;
}

/**
 * Streams one resume turn: server-side history + workspace are replayed by the
 * backend; wire events arrive under the thread-owned SSE channel (`event: thread`).
 */
export async function streamThreadRun(options: StreamThreadRunOptions): Promise<void> {
  const { threadId, question, onEvent, signal, onParseError } = options;
  let res: Response;
  try {
    res = await apiFetch(`${API_BASE}/api/threads/${encodeURIComponent(threadId)}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ question } satisfies ThreadRunRequest),
      signal,
      timeout: false, // SSE long connection: no timeout
    });
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) return;
    throw err;
  }

  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new ApiError(text || "Thread run failed", "http", res.status);
  }

  await pumpSSEBlocks(
    res,
    (json) => {
      if (json === "[DONE]") return;
      let parsed: ArenaEvent;
      try {
        parsed = JSON.parse(json) as ArenaEvent;
      } catch (err) {
        if (onParseError) onParseError(json, err as Error);
        return;
      }
      onEvent(parsed);
    },
    signal,
  );
}
