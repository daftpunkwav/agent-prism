# HTTP API

All routes are registered by the route leaves under `packages/transport/` and mounted by
`apps/server/src/mount-routes.ts` in the order provider, settings, sessions, arena,
workspace, projects, builder, threads. The source of truth is the route file cited in
each section.

## Cross-cutting behavior in `packages/transport/http-runtime`

- CORS. The allowlist is built from `http://localhost:<FRONTEND_PORT>`,
  `http://127.0.0.1:<FRONTEND_PORT>`, and `CORS_ORIGINS` entries. A `*` is rejected at
  settings load. Methods are `GET`, `POST`, `PUT`, `DELETE`, and `OPTIONS`. Headers are
  `Content-Type`, `Authorization`, and `X-API-Token`.
- Auth. If `API_TOKEN` is empty, all requests pass. `/api/health` and `/health` are
  exempt. Credentials are `Authorization: Bearer <token>` with a case-insensitive scheme,
  or `X-API-Token: <token>`. Failure returns `401 {"detail": …}`.
- Body limits. `MAX_REQUEST_SIZE` defaults to 10 MiB and is enforced on
  `Content-Length` and again while streaming, so chunked bodies cannot bypass it.
  Oversize returns `413`. Non-JSON bodies return `400`, and schema violations return
  `422` with the first zod issue message.
- Error shape. `AppError` and `BuilderError` return `{"detail"}` with their own status.
  Anything else returns `500` with a sanitized message.
- Health. `GET /api/health` and `GET /health` return
  `{"status":"ok","service":"arena"}`.

## Provider settings in `route-provider/src/provider.ts`

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/settings/provider` | public provider config view | keys masked, never raw |
| PUT | `/api/settings/provider` | save provider config | zod-validated, else 422; the legacy flat protocol is accepted; empty keys inherit stored keys by endpoint id or fingerprint |
| POST | `/api/settings/provider/test` | connectivity test, no save | an empty body tests the stored config |

## Settings knobs and memory in `route-settings/src/settings.ts`

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/settings/knobs` | read the current runtime knobs | returns `{knobs, fields}`; registration is skipped when the host injects no knob store |
| PUT | `/api/settings/knobs` | hot-apply knob updates | returns `{knobs, fields}` |
| GET | `/api/settings/memory` | cross-session memory status | episodic and semantic counts and file paths |
| POST | `/api/settings/memory/clear` | clear both memory stores | returns the status |

## Sessions in `route-sessions/src/sessions.ts`

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/sessions/stats` | counts by kind and status | registered before `/:sessionId` on purpose |
| GET | `/api/sessions/telemetry` | plain-text telemetry report | deterministic rendered lines, empty kinds omitted; registered before `/:sessionId` for the same path-shape reason |
| GET | `/api/sessions` | filtered listing | `kind` is `arena`, `agent`, or `builder`; `status` is `active`, `completed`, `failed`, or `cancelled`; `limit` is at least 0 with a cap of 200; violations return 400 |
| GET | `/api/sessions/:sessionId` | record and entries | 404 when missing |
| GET | `/api/sessions/:sessionId/export` | JSON download | `Content-Disposition: attachment`; `exportedAt` from the injected clock |
| POST | `/api/sessions/export` | batch export by ids | body `ids`; returns `{documents}`; the body size limit holds even for chunked requests without `Content-Length` |
| DELETE | `/api/sessions/:sessionId` | operator delete | `{deleted: <id>}`; blob sidecars purged |

## Arena in `route-arena/src/arena.ts`

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/arena/meta` | dimensions, options, and templates metadata | `min_select` is 1; the UI may sit at zero selections with the run disabled |
| POST | `/api/arena/run` | start one comparison run | SSE with event name `"arena"`. Body: `question` of 1 to 4000 characters, `dimension` defaulting to `framework`, `selections` of at most 16 and at least 1, or omitted for all, optional `column_sessions`, and `attachments` of at most 5 with 64 KiB text each. `onAbort` cancels the run, and abort books `cancelled`. In-stream failures are emitted as `error` events, never a silent close |
| POST | `/api/arena/answer` | answer one pending ask_user question | body of `agent_id`, `question_id`, and `answer`; 404 when no live column waits |
| GET | `/api/arena/pending-asks` | columns waiting on the human | returns `{pending}`, one `{agentId, questions}` entry per column with its full pending ask_user questions |
| POST | `/api/arena/stop-column` | stop one live column only | body `agent_id` from column events; other columns keep running; the stopped column settles with a `Column stopped by user` error and a failed complete; 404 when already settled |
| GET | `/api/arena/column-logs` | per-column run logs of raw events and captured LLM wire | `?workspace=` and `?label=` required, else 400. Returns `{workspace, label, events, wire, truncated}` with a tail cap. Safe to poll while a run streams. An unknown workspace or label yields an empty result, not 404 |
| GET | `/api/arena/templates` | task templates | `{templates: […]}` with 15 scored and 11 quick |
| POST | `/api/arena/judge` | judge answers | `template_id` and an `answers` record of at most 16 |
| POST | `/api/arena/judge-async` | judge answers through the async port | same body as `/api/arena/judge`; `llm` templates use the bound async judge when wired, otherwise the sync fail-closed verdict explains the missing wiring |
| POST | `/api/arena/matrix` | 1 to 8 template cells | SSE with event name `"matrix"`; `matrix_progress` and a final `matrix_report`; per-cell failures isolated; same abort semantics |

## Workspace files in `route-workspace/src/workspace.ts`

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/arena/workspace/:workspaceName/files` | list workspace files | |
| GET | `/api/arena/workspace/:workspaceName/file` | read one file | `?path=` required, else 400 |
| PUT | `/api/arena/workspace/:workspaceName/file` | write or create | `path` at most 512 characters, `content` at most 512 Ki characters, `create_only` default false |
| DELETE | `/api/arena/workspace/:workspaceName/file` | delete file | `?path=` required |

## Projects in `route-projects/src/projects.ts`

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/arena/projects` | list saved projects | |
| POST | `/api/arena/projects` | archive a run as a project | `workspace_names` defaulted from `pipeline_labels`; a save failure returns 500 |
| DELETE | `/api/arena/projects/:projectId` | delete project | 404 when absent |

## Builder in `route-builder/src/builder.ts`

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/builder/catalog` | option catalog for composition | |
| GET | `/api/builder/sessions` | list builder sessions | |
| POST | `/api/builder/sessions` | create session | `name` at most 60 characters; an empty name makes the store generate a display name; partial `composition` |
| GET | `/api/builder/sessions/:id` | detail including the trace log | |
| PATCH | `/api/builder/sessions/:id` | hot-swap the composition between turns | |
| DELETE | `/api/builder/sessions/:id` | delete session | |
| POST | `/api/builder/sessions/:id/abort` | abort an in-flight turn | `{ok, aborted}` |
| POST | `/api/builder/sessions/:id/chat` | one chat turn | SSE with event name `"builder"`; `message` at most 12 000 characters; `attachments` at most 5; terminates with `[DONE]` unless the client disconnected |

## Threads in `route-threads/src/threads.ts`

Durable fork and resume threads. Semantics, caps, and the run loop are detailed in
[threads.md](threads.md).

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/threads` | list thread views | oldest first, no transcript |
| POST | `/api/threads` | create thread | body `{title?, config}`; `config` is a full `PipelineConfig` and defaults apply |
| GET | `/api/threads/:id` | detail | `{thread, history}`; 404 when missing |
| DELETE | `/api/threads/:id` | delete thread | 409 while a turn is running |
| POST | `/api/threads/:id/fork` | fork | transcript copy and workspace branch; `fork_of` set; 409 when running |
| POST | `/api/threads/:id/run` | run one turn, resuming | SSE with event name `"thread"`; conflicts and 404 surface as HTTP status codes before the stream opens |

## Client mapping in `packages/client`

The web app never calls these URLs by hand. `packages/client/client/src` maps them one to
one: `fetchArenaMeta`, `streamArenaRun`, `streamMatrixRun`, `fetchTemplates`, and
`judgeAnswers` with project and workspace helpers in `client.ts`, builder helpers in
`builder.ts`, session helpers in `sessions.ts`, and thread helpers in `threads.ts`. URLs
are prefixed with `NEXT_PUBLIC_API_BASE` when set. REST calls get a default 15-second
timeout, and SSE streams are opened with `timeout: false` and support abort.
