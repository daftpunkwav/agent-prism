/**
 * @file client
 * @description Browser API client covering every non-Builder Arena backend route (builder lives in builder.ts).
 *
 * Responsibilities:
 * - Metadata and provider CRUD (fetch, save, connection test)
 * - SSE run streaming with abort support
 * - Judging, project CRUD, and workspace file read/write/delete/list
 *
 * Thin transport only: no state, no retry policy, no UI concerns.
 */

import { API_BASE, ApiError, apiFetch, isAbortError, responseDetail } from "./http.js";
import type { MemoryStatus, RuntimeKnobsPayload } from "./types.js";
import { pumpSSEBlocks } from "./sse.js";
import type {
  ConnectionTestResult,
  LlmEndpointUpdateInput,
  ProviderConfigUpdateInput,
  RunAttachment,
  RuntimeKnobFieldMeta,
  RuntimeKnobs,
} from "@agentprism/contracts";
import type {
  ArenaEvent,
  ArenaMeta,
  ColumnLogs,
  BaselineOverrides,
  ChatMessage,
  ColumnSession,
  DimensionId,
  JudgeResult,
  Project,
  ProjectCreate,
  ProviderConfig,
  TaskTemplate,
  WorkspaceFileEntry,
} from "./types";
/** Loads Arena metadata (dimensions, frameworks, baselines); throws ApiError on HTTP failure. */
export async function fetchArenaMeta(options?: { signal?: AbortSignal }): Promise<ArenaMeta> {
  const res = await apiFetch(`${API_BASE}/api/arena/meta`, {
    cache: "no-store",
    signal: options?.signal,
  });
  if (!res.ok) throw new ApiError("Failed to load Arena metadata", "http", res.status);
  return res.json();
}

/** Loads the stored provider config for the settings form; throws ApiError on HTTP failure. */
export async function fetchProvider(options?: { signal?: AbortSignal }): Promise<ProviderConfig> {
  const res = await apiFetch(`${API_BASE}/api/settings/provider`, {
    cache: "no-store",
    signal: options?.signal,
  });
  if (!res.ok) throw new ApiError("Failed to load Provider config", "http", res.status);
  return res.json();
}

/**
 * Saves the provider config.
 *
 * api_key has two-layer semantics: omitting the top-level key = backend keeps the
 * stored default key; an empty string inside endpoints = backend inherits the stored
 * key by endpoint id/connection fingerprint. Omission and empty string are not the
 * same meaning and must not be swapped.
 */
export async function saveProvider(body: ProviderConfigUpdateInput): Promise<ProviderConfig> {
  // Top-level empty api_key is omitted (schema default fills in); empty keys inside endpoints keep the field so the backend can merge by id/fingerprint
  const payload = { ...body };
  const key = payload.api_key;
  if (typeof key !== "string" || !key.trim()) {
    delete payload.api_key;
  }
  if (Array.isArray(payload.endpoints)) {
    payload.endpoints = (payload.endpoints as LlmEndpointUpdateInput[]).map((ep) => {
      const next = { ...ep };
      if (typeof next.api_key !== "string" || !String(next.api_key).trim()) {
        next.api_key = "";
      }
      return next;
    });
  }
  const res = await apiFetch(`${API_BASE}/api/settings/provider`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Save failed"), "http", res.status);
  return res.json();
}

/** Tests provider connectivity without saving; returns per-endpoint results. Never persists anything. */
export async function testProvider(body: ProviderConfigUpdateInput): Promise<ConnectionTestResult> {
  const res = await apiFetch(`${API_BASE}/api/settings/provider/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Connection test failed"), "http", res.status);
  return res.json();
}

/** Named options for streamArenaRun (avoids a long positional parameter list). */
export interface StreamArenaRunOptions {
  question: string;
  dimension: DimensionId;
  onEvent: (event: ArenaEvent) => void;
  signal?: AbortSignal;
  selections?: string[];
  baseline?: BaselineOverrides;
  onParseError?: (raw: string, err: Error) => void;
  messages?: ChatMessage[];
  columnSessions?: Record<string, ColumnSession>;
  /** Text files seeded into newly created column workspaces for this run. */
  attachments?: RunAttachment[];
}

/**
 * Streams an Arena run's results.
 *
 * SSE parsing notes:
 * - ``data: <json>`` payloads are forwarded to onEvent
 * - defensive [DONE] guard (only builder sends it; arena ends by close)
 * - JSON parse errors go to ``onParseError`` (no longer swallowed silently)
 * - the whole read loop honors the passed AbortSignal: disconnects immediately on unmount
 */
export async function streamArenaRun(options: StreamArenaRunOptions): Promise<void> {
  const { question, dimension, onEvent, signal, selections, baseline, onParseError, messages, columnSessions } = options;
  let res: Response;
  try {
    const body: Record<string, unknown> = {
      question,
      dimension,
      selections: selections ?? [],
      // Browser runs are interactive: ask_user questions may block on /api/arena/answer.
      interactive: true,
    };
    if (baseline && Object.keys(baseline).length > 0) {
      body.baseline = baseline;
    }
    if (messages && messages.length > 0) {
      body.messages = messages;
    }
    if (columnSessions && Object.keys(columnSessions).length > 0) {
      body.column_sessions = columnSessions;
    }
    if (options.attachments && options.attachments.length > 0) {
      body.attachments = options.attachments;
    }
    res = await apiFetch(`${API_BASE}/api/arena/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
      timeout: false, // SSE long connection: no timeout
    });
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) return;
    throw err;
  }

  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new ApiError(text || "Arena run failed", "http", res.status);
  }

  // Block assembly, tail-block parsing, and abort-silence live in the shared pump;
  // only payload typing and the defensive [DONE] guard stay here.
  await pumpSSEBlocks(
    res,
    (json) => {
      if (json === "[DONE]") return; // silent end (only builder sends it; arena ends by close)
      // JSON parsing and callback dispatch are separated: exceptions from onEvent itself must not be misattributed as parse errors.
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

/** Delivers the human's answer to one pending ask_user question of a live column. */
export async function answerArenaQuestion(agentId: string, questionId: string, answer: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/arena/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: agentId, question_id: questionId, answer }),
  });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Failed to deliver answer"), "http", res.status);
}

/** Independently stops one live Arena column (other columns keep running). */
export async function stopArenaColumn(agentId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/arena/stop-column`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: agentId }),
  });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Failed to stop column"), "http", res.status);
}

/** Matrix progress/report item streamed from POST /api/arena/matrix. */
export interface MatrixStreamItem {
  type: "matrix_progress" | "matrix_report" | string;
  template_id?: string;
  status?: string;
  score?: string;
  error?: string;
  report?: unknown;
}

/** Named options for streamMatrixRun (avoids a long positional parameter list). */
export interface StreamMatrixOptions {
  cells: Array<{ template_id: string; dimension?: string; selections?: string[]; baseline?: BaselineOverrides }>;
  onItem: (item: MatrixStreamItem) => void;
  signal?: AbortSignal;
  onParseError?: (raw: string, err: Error) => void;
}

/**
 * Streams a comparison matrix run: per-cell progress plus one final report.
 * Shape mirrors streamArenaRun (SSE `matrix` events, `[DONE]` guard, abort-silence).
 */
export async function streamMatrixRun(options: StreamMatrixOptions): Promise<void> {
  const { cells, onItem, signal, onParseError } = options;
  let res: Response;
  try {
    res = await apiFetch(`${API_BASE}/api/arena/matrix`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ cells }),
      signal,
      timeout: false, // SSE long connection: no timeout
    });
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) return;
    throw err;
  }
  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new ApiError(text || "Matrix run failed", "http", res.status);
  }
  await pumpSSEBlocks(
    res,
    (json) => {
      if (json === "[DONE]") return;
      let parsed: MatrixStreamItem;
      try {
        parsed = JSON.parse(json) as MatrixStreamItem;
      } catch (err) {
        if (onParseError) onParseError(json, err as Error);
        return;
      }
      onItem(parsed);
    },
    signal,
  );
}

/** Lists judging task templates (`templates` payload, never null); throws ApiError on HTTP failure. */
export async function fetchTemplates(options?: { signal?: AbortSignal }): Promise<TaskTemplate[]> {
  const res = await apiFetch(`${API_BASE}/api/arena/templates`, {
    cache: "no-store",
    signal: options?.signal,
  });
  if (!res.ok) throw new ApiError("Failed to load task templates", "http", res.status);
  const data = await res.json();
  return data.templates || [];
}

/**
 * Judges one answer per column label with a task template.
 *
 * @param templateId Task template id (server validates, 404s unknown ids).
 * @param answers Column label to final-answer text.
 * @returns Label to per-column verdict (empty object when the payload carries none).
 * @throws ApiError on HTTP failure.
 */
export async function judgeAnswers(
  templateId: string,
  answers: Record<string, string>,
): Promise<Record<string, JudgeResult>> {
  const res = await apiFetch(`${API_BASE}/api/arena/judge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template_id: templateId, answers }),
  });
  if (!res.ok) throw new ApiError("Judging failed", "http", res.status);
  const data = await res.json();
  return data.results || {};
}

/** Lists archived projects (`projects` payload, never null); throws ApiError on HTTP failure. */
export async function listProjects(signal?: AbortSignal): Promise<Project[]> {
  const res = await apiFetch(`${API_BASE}/api/arena/projects`, { cache: "no-store", signal });
  if (!res.ok) throw new ApiError("Failed to load projects", "http", res.status);
  const data = await res.json();
  return data.projects || [];
}


/** Archives the current run as a project; returns the stored record. Throws ApiError (with server detail) on failure. */
export async function createProject(body: ProjectCreate): Promise<{ project: Project }> {
  const res = await apiFetch(`${API_BASE}/api/arena/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Failed to create project"), "http", res.status);
  return res.json();
}

/** Deletes an archived project by id (URL-encoded); 404 surfaces as ApiError. Resolves void on success. */
export async function deleteProject(projectId: string): Promise<void> {
  const res = await apiFetch(
    `${API_BASE}/api/arena/projects/${encodeURIComponent(projectId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new ApiError(await responseDetail(res, "Failed to delete project"), "http", res.status);
}

/** Lists files of a run workspace (`files` payload, never null); throws ApiError on HTTP failure. */
export async function listWorkspaceFiles(workspaceName: string, signal?: AbortSignal): Promise<WorkspaceFileEntry[]> {
  const res = await apiFetch(
    `${API_BASE}/api/arena/workspace/${encodeURIComponent(workspaceName)}/files`,
    { signal },
  );
  if (!res.ok) throw new ApiError("Failed to load file list", "http", res.status);
  const data = await res.json();
  return data.files || [];
}

/**
 * Fetches one column's per-run observability logs (raw events + captured LLM wire
 * records). Safe to poll while the run streams: the backend only reads JSONL tails.
 *
 * @param workspace Workspace segment owning the run logs.
 * @param label Pipeline label of the column (log file stem).
 */
export async function fetchColumnLogs(
  workspace: string,
  label: string,
  signal?: AbortSignal,
): Promise<ColumnLogs> {
  const params = new URLSearchParams({ workspace, label });
  const res = await apiFetch(`${API_BASE}/api/arena/column-logs?${params.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new ApiError("Failed to load column logs", "http", res.status);
  // Shape-guard the polled body: a version-skewed or gateway-rewritten 200 JSON
  // must degrade to empty logs, not crash the logs tab mid-render (same policy
  // as listWorkspaceFiles above; the page renders these arrays unguarded).
  const data = (await res.json()) as Partial<ColumnLogs> | null;
  return {
    workspace: typeof data?.workspace === "string" ? data.workspace : workspace,
    label: typeof data?.label === "string" ? data.label : label,
    events: Array.isArray(data?.events) ? data.events : [],
    wire: Array.isArray(data?.wire) ? data.wire : [],
    truncated: data?.truncated === true,
  };
}

/**
 * Reads one workspace file as text.
 *
 * @param workspaceName Run workspace segment from the run history.
 * @param path Workspace-relative file path (URL-encoded).
 * @returns File content (empty string when the payload carries none).
 * @throws ApiError on HTTP failure (unknown workspace/file 404s).
 */
export async function readWorkspaceFile(
  workspaceName: string,
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await apiFetch(
    `${API_BASE}/api/arena/workspace/${encodeURIComponent(workspaceName)}/file?path=${encodeURIComponent(path)}`,
    { signal },
  );
  if (!res.ok) throw new ApiError("Failed to read file", "http", res.status);
  const data = await res.json();
  return data.content || "";
}

/**
 * Writes a workspace file (creates parent dirs server-side).
 *
 * @param workspaceName Run workspace segment from the run history.
 * @param path Workspace-relative file path (URL-encoded).
 * @param content Full new file content (whole-file replace, no patching).
 * @param createOnly When true the server refuses overwriting an existing file.
 * @returns Resolves void on success; server detail surfaces through ApiError.
 */
export async function saveWorkspaceFile(
  workspaceName: string,
  path: string,
  content: string,
  createOnly = false,
  signal?: AbortSignal,
): Promise<void> {
  const res = await apiFetch(
    `${API_BASE}/api/arena/workspace/${encodeURIComponent(workspaceName)}/file`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content, create_only: createOnly }),
      signal,
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Save failed" }));
    throw new ApiError(err.detail || "Save failed", "http", res.status);
  }
}

/** Deletes one workspace file (both segments URL-encoded); 404 surfaces as ApiError. Resolves void on success. */
export async function deleteWorkspaceFile(
  workspaceName: string,
  path: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await apiFetch(
    `${API_BASE}/api/arena/workspace/${encodeURIComponent(workspaceName)}/file?path=${encodeURIComponent(path)}`,
    { method: "DELETE", signal },
  );
  if (!res.ok) throw new ApiError("Failed to delete file", "http", res.status);
}

/** Loads the runtime knobs (current values + field metadata for settings UI). */
export async function fetchRuntimeKnobs(options?: { signal?: AbortSignal }): Promise<RuntimeKnobsPayload> {
  const res = await apiFetch(`${API_BASE}/api/settings/knobs`, {
    cache: "no-store",
    signal: options?.signal,
  });
  if (!res.ok) throw new ApiError("Failed to load runtime knobs", "http", res.status);
  return res.json();
}

/** Saves runtime knobs; the server hot-applies them (no restart needed). */
export async function saveRuntimeKnobs(knobs: Record<string, unknown>): Promise<RuntimeKnobsPayload> {
  const res = await apiFetch(`${API_BASE}/api/settings/knobs`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(knobs),
  });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Failed to save runtime knobs"), "http", res.status);
  return res.json();
}

/** Loads the memory store status (counts + storage paths). */
export async function fetchMemoryStatus(options?: { signal?: AbortSignal }): Promise<MemoryStatus> {
  const res = await apiFetch(`${API_BASE}/api/settings/memory`, {
    cache: "no-store",
    signal: options?.signal,
  });
  if (!res.ok) throw new ApiError("Failed to load memory status", "http", res.status);
  return res.json();
}

/** Clears both memory stores; returns the post-clear status. */
export async function clearMemory(options?: { signal?: AbortSignal }): Promise<MemoryStatus> {
  const res = await apiFetch(`${API_BASE}/api/settings/memory/clear`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new ApiError("Failed to clear memory", "http", res.status);
  return res.json();
}
