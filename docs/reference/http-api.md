# HTTP API

All routes are registered by the route leaves under `packages/transport/` and mounted by
`apps/server/src/mount-routes.ts` in the order provider, settings, sessions, arena,
workspace, projects, builder, threads. The source of truth is the route file cited in
each section.

## Cross-cutting behavior in `packages/transport/http-runtime`

- CORS. The allowlist is built from `http://localhost:<FRONTEND_PORT>`,
  `http://127.0.0.1:<FRONTEND_PORT>`, and `CORS_ORIGINS` entries. A `*` is rejected at
  settings load. Methods are `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS`.
  Headers are `Content-Type`, `Authorization`, and `X-API-Token`.
- Guards. If `API_TOKEN` is empty, every request passes auth; a request can still be
  rejected by the other guards. On a loopback bind, a non-allowlisted `Host` header
  returns `403` (DNS-rebinding guard). A state-changing request (`POST`, `PUT`, `PATCH`,
  `DELETE`) carrying an `Origin` header that is not in the CORS allowlist returns `403`
  (cross-site guard); requests without `Origin`, such as curl or server-to-server calls,
  pass.
- Auth. `/api/health` and `/health` are exempt. Credentials are
  `Authorization: Bearer <token>` with a case-insensitive scheme, or
  `X-API-Token: <token>`. Failure returns `401 {"detail": …}`.
- Body limits. `MAX_REQUEST_SIZE` defaults to 10 MiB and is enforced on
  `Content-Length` and again while streaming, so chunked bodies cannot bypass it.
  Oversize returns `413`. Malformed JSON returns `400` everywhere.
- Error shape. `AppError` and `BuilderError` return `{"detail"}` with their own status.
  Anything else returns `500` with a sanitized message. Schema-validated families
  (arena, builder, threads, workspace upsert, session export) answer `422` with the
  first zod issue message on a mismatch. Provider save and its connectivity test parse
  the held body through the same zod schema, so a shape error is `422` before any
  semantic check; `saveProvider` then answers `400` for a semantically invalid config.
  The `/api/settings/*` endpoints hand-validate and answer `400` for bad input, `409`
  for a skill-name collision with a bundled or existing skill, and a mapped `5xx` when
  a persisted store write fails.
- Health. `GET /api/health` and `GET /health` return
  `{"status":"ok","service":"arena"}`.

## Provider settings in `route-provider/src/provider.ts`

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/settings/provider` | public provider config view | keys masked, never raw |
| PUT | `/api/settings/provider` | save provider config | zod-validated, else 422; semantic config validation answers 400; the legacy flat protocol is accepted; empty keys inherit stored keys by endpoint id or fingerprint; a real key is never returned |
| POST | `/api/settings/provider/test` | connectivity test, no save | an empty body tests the stored config |

## Settings knobs, memory, skills, and MCP in `route-settings/src/settings.ts`

Each family is registered only when the host injects its controller; a host without the
seam keeps booting. Settings endpoints validate by hand and answer `400` for bad input
(see cross-cutting behavior).

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/settings/knobs` | read the current runtime knobs | returns `{knobs, fields}` |
| PUT | `/api/settings/knobs` | hot-apply knob updates | always `200`: out-of-range or malformed fields clamp or fall back to the current value, and `knobs` in the response carries the effective values |
| GET | `/api/settings/memory` | cross-session memory status | episodic and semantic counts and file paths |
| POST | `/api/settings/memory/clear` | clear both memory stores | persists before answering, so a write failure becomes a mapped `5xx` |
| GET | `/api/settings/skills` | list the effective skill catalog | `{skills}` with name, description, source, and enabled flag |
| POST | `/api/settings/skills` | create a user skill | body `name`, `description`, `body`; `201`; `409` for a bundled or duplicate name |
| PUT | `/api/settings/skills/:name` | update a user skill | body `description` and/or `body`; `400` for unknown names, `409` for bundled ones |
| DELETE | `/api/settings/skills/:name` | delete a user skill | `{ok:true}`; same `400`/`409` split |
| PUT | `/api/settings/skills/:name/enabled` | enable or disable a skill | body `enabled` boolean, else `400` |
| GET | `/api/settings/mcp` | read the managed MCP server list | `{servers}` |
| PUT | `/api/settings/mcp` | replace the whole managed MCP server list | body `servers` array; non-array `400`, invalid server config `400` with the parser message |

## Sessions in `route-sessions/src/sessions.ts`

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/sessions/stats` | counts by kind and status | registered before `/:sessionId` on purpose |
| GET | `/api/sessions/telemetry` | plain-text telemetry report | deterministic rendered lines, empty kinds omitted; registered before `/:sessionId` for the same path-shape reason |
| GET | `/api/sessions` | filtered listing, or an advanced query page | `kind` is `arena`, `agent`, or `builder`; `status` is `active`, `completed`, `failed`, or `cancelled`; `limit` is an integer of at least 1 with a cap of 200; violations return 400. Any of `q`, `sort` (`newest`, `oldest`, `title`), `offset`, `kinds`, `statuses` (comma-separated, at most 10 tokens each), `createdFrom`, `createdTo`, `updatedTo` (epoch ms), or `entryText` (at most 500 chars) switches the response to `{sessions, total, limit, offset}` |
| GET | `/api/sessions/:sessionId` | record and entries | 404 when missing; `limit` (default 50, cap 500) and `offset` window the entries |
| GET | `/api/sessions/:sessionId/export` | JSON download | `Content-Disposition: attachment`; `exportedAt` from the injected clock |
| POST | `/api/sessions/export` | batch export by ids | body `ids`; returns `{documents}`; the body size limit holds even for chunked requests without `Content-Length` |
| DELETE | `/api/sessions/:sessionId` | operator delete | `{deleted: <id>}`; blob sidecars purged |

## Arena in `route-arena/src/arena.ts`

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/arena/meta` | dimension and baseline metadata | Dimension cards with their options, frameworks, `baseline_defaults`, `baseline_fields`, `thinking_by_endpoint` (per-endpoint thinking-axis projection), and `model_compare_ready`. The UI may sit at zero selections with the run disabled |
| POST | `/api/arena/run` | start one comparison run | SSE with event name `"arena"`. Body: `question` of 1 to 4000 characters, `dimension` defaulting to `framework` and accepting any registered custom dimension id (an unknown axis is rejected with 422 before the stream opens), `selections` of up to 16 dimension values (an empty or omitted list fails with an in-stream `error` event), optional `baseline` overrides and `temperature`, a fallback `messages` transcript (at most 24 messages), `column_sessions`, `attachments` of at most 5 with 64 KiB text each, `interactive` defaulting to false (enables live `ask_user`), and `language` (at most 16 chars). `onAbort` cancels the run, and abort books `cancelled`. In-stream failures are emitted as `error` events, never a silent close |
| POST | `/api/arena/answer` | answer one pending ask_user question | body of `agent_id`, `question_id`, and `answer`; 404 when no live column waits |
| GET | `/api/arena/pending-asks` | columns waiting on the human | returns `{pending}`, one `{agentId, questions}` entry per column with its full pending ask_user questions |
| POST | `/api/arena/stop-column` | stop one live column only | body `agent_id` from column events; other columns keep running; the stopped column settles with a `Column stopped by user` error and a failed complete; 404 when already settled |
| GET | `/api/arena/column-logs` | per-column run logs of raw events and captured LLM wire | `?workspace=` and `?label=` required, else 400. Merges every run that hosted the workspace (follow-up turns included), chronological, tail-capped. Returns `{workspace, label, events, wire, truncated}`. Safe to poll while a run streams. An unknown workspace or label yields an empty result, not 404 |
| GET | `/api/arena/templates` | task templates | `{templates: […]}` with 15 scored and 11 quick |
| POST | `/api/arena/judge` | judge answers | `template_id` and an `answers` record of at most 16 |
| POST | `/api/arena/judge-async` | judge answers through the async port | same body as `/api/arena/judge`; `llm` templates use the bound async judge when wired, otherwise the sync fail-closed verdict explains the missing wiring |
| POST | `/api/arena/matrix` | 1 to 32 template cells | SSE with event name `"matrix"`; `matrix_progress` and a final `matrix_report`; per-cell failures isolated; same abort semantics |

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
| GET | `/api/builder/catalog` | option catalog for composition | endpoints disabled in settings are not offered |
| GET | `/api/builder/sessions` | list builder sessions | |
| POST | `/api/builder/sessions` | create session | `name` at most 60 characters; an empty name makes the store generate a display name; partial `composition` |
| GET | `/api/builder/sessions/:id` | detail including the trace log | |
| PATCH | `/api/builder/sessions/:id` | hot-swap the composition between turns | same configure-time validation as create (unknown or disabled endpoint, `claude_agent_sdk` endpoint format, illegal custom values); a rejected swap returns 422 and leaves the stored composition unchanged |
| DELETE | `/api/builder/sessions/:id` | delete session | |
| POST | `/api/builder/sessions/:id/abort` | abort an in-flight turn | `{ok, aborted}` |
| GET | `/api/builder/sessions/:id/pending-ask` | questions waiting on the human | `{questions}` for this session's live turn |
| POST | `/api/builder/sessions/:id/answer` | deliver one human answer | body `question_id` and optional `answer` (empty means skip); 404 when no pending question matches |
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
`judgeAnswers`, the provider and settings helpers (`fetchProvider`, `saveProvider`,
`testProvider`, runtime knobs, memory, skills, and MCP), plus project and workspace
helpers in `client.ts`, builder helpers in `builder.ts`, session helpers in `sessions.ts`,
and thread helpers in `threads.ts`. URLs are prefixed with `NEXT_PUBLIC_API_BASE` when
set. REST calls get a default 15-second timeout, and SSE streams are opened with
`timeout: false` and support abort.
