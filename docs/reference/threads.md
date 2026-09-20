# Threads

Durable agent threads consist of a server-held transcript plus a persistent workspace
per thread id. They are designed for fork, which branches a past conversation, and
resume, which continues after an interruption or restart. Sources of truth:
`packages/application/application/src/thread-store.ts` for the store,
`thread-service.ts` for the use cases, `packages/transport/route-threads` for the routes,
and `packages/contracts/contracts/src/thread.ts` for the contracts.

## Semantics

- Resume is thread-level, not step-level. A turn commits only on successful completion,
  appending the question, the extracted answer, and the resolved workspace in one atomic
  write. A failed or aborted turn leaves the transcript untouched, so the next run
  resumes from the last committed point. There is no mid-step pause, because the run
  restarts the turn from the committed history.
- History and workspace are replayed server-side. Every run goes through the full arena
  pipeline, covering concurrency slots, circuit breakers, events, workspace rehydration,
  and the sandbox and approval layers, with the thread's pinned `PipelineConfig`. The
  column label is pinned to `t-<threadId>` through the baseline `label` override.
- Cross-restart for the transcript is automatic. `data/threads.json` persists threads
  with debounced atomic writes, `.bak` recovery, and per-item corruption containment. A
  `running` flag left by a previous process resets to idle on load. On the next run or
  detail read, the workspace is rehydrated from `data/runs/` and pinned, which exempts it
  from the workspace registry TTL and LRU eviction for the thread's lifetime through
  `WorkspaceRegistry.pin` until deletion. Pinned workspaces still occupy registry quota.
  The thread ceiling and registry size are env-tuned through `MAX_THREADS` and
  `MAX_WORKSPACES`, and settings fail fast unless the registry exceeds the thread
  ceiling, so pins cannot crowd out arena columns entirely.
- Config is pinned at creation. The full `PipelineConfig` captured by `POST /api/threads`
  is replayed on every run. Baseline-supported fields map one to one, and `model_id`
  derives from endpoint resolution. Creation validates the config with the same resolver
  the run path uses, so an unreplayable value returns `422` at creation rather than an
  in-stream error on every later run. An unset `endpoint_id` is omitted so the default
  endpoint still resolves. `prompt_version` is not a baseline field; it follows the
  running build rather than the thread, so threads resumed after a prompt upgrade pick up
  the new prompt.

## Fork

`POST /api/threads/:id/fork` copies the transcript and `config`, stamps `fork_of`, and,
when the parent has a workspace, branches it with `WorkspaceRegistry.clone`, a
byte-for-byte directory copy beside the source. The two trees diverge independently.
Forking a running thread returns `409`, forking while the source workspace is protected
by a live run returns `409`, and a failed branch leaves no record behind.

## Caps and lifecycle

All numeric caps are env-tunable through `MAX_THREADS`, `THREAD_MAX_HISTORY_MESSAGES`,
and `THREAD_MAX_HISTORY_CHARS`. The table shows the defaults.

| Cap | Default | Behavior |
|---|---|---|
| Threads per store | 24 from `MAX_THREADS` | create or fork returns `409` when full, with no eviction |
| History messages | 60 from `THREAD_MAX_HISTORY_MESSAGES` | the oldest user and assistant pairs are dropped |
| History characters | 96 000 from `THREAD_MAX_HISTORY_CHARS` | applied with the message cap after each commit |
| Title | 120 characters | empty resolves to a generated `Thread <base36 time>` |
| Per-message wire cap | 32 000 characters | `ThreadMessageSchema` |

The characters cap is the window-facing dial. Drivers trim to the context strategy's
window per LLM call, defaulting to `sliding` with the last 12 messages, so the worst-case
prompt size is bounded by the per-message clamp times the window and by this characters
cap. Size it to the smallest endpoint context window in use.

These caps are looser than the arena wire caps for `column_sessions` on purpose. Thread
history never crosses HTTP as request state, and context trimming stays with the pipeline
strategies.

Delete refuses while a turn is running with `409`, and the workspace pin is kept in that
case. The workspace directory is kept on disk because it is under the `data/runs/` TTL
and LRU ownership. Deleting a parent leaves an existing fork's `fork_of` pointing at a
removed id, which is informational rather than a dangling reference to follow, because
the fork keeps its own transcript and workspace.

## HTTP surface in `route-threads/src/threads.ts`

Every run flows through `ArenaService.run`, so each turn also opens an execution-ledger
session in `data/sessions.json` with an outline digest. This is best-effort and never
load-bearing: the thread transcript in `data/threads.json` is the authoritative resume
state, and a ledger failure never interrupts a turn.

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/threads` | list views without transcript | oldest first |
| POST | `/api/threads` | create | body `{title?, config}`; `config` is a full `PipelineConfig` and defaults apply; `422` when the config cannot be replayed |
| GET | `/api/threads/:id` | detail | `{thread, history}` |
| DELETE | `/api/threads/:id` | delete | `409` while running |
| POST | `/api/threads/:id/fork` | fork | body `{title?}`; transcript copy and workspace branch |
| POST | `/api/threads/:id/run` | run one turn, resuming | SSE with event name `"thread"` and the same event payload contract as arena runs; conflicts and 404 surface as HTTP status codes before the stream opens |

Stop a live thread turn with the existing arena route `POST /api/arena/stop-column`,
using the `agentId` from the stream's events.

## Client mapping

`packages/client/client/src/threads.ts` mirrors the surface one to one: `listThreads`,
`createThread`, `getThread`, `forkThread`, `deleteThread`, and `streamThreadRun`.

## Tests

- Store: `packages/application/application/tests/thread-store.test.ts` covers caps, fork
  copy, stale-running reset, and corruption containment.
- Service: `packages/application/application/tests/thread-service.test.ts` covers request
  assembly, success-only commit, 409 guards, fork branching, the pinned baseline list
  against the wire schema, create-time validation, and pin retention on a refused delete.
- Registry: `packages/runtime/runtime/tests/workspace-clone.test.ts` covers copy
  semantics, source protection during the copy, and no partial clone on failure.
- Routes: `packages/transport/route-threads/tests/threads.test.ts` covers CRUD, the SSE
  shape, and 409, 404, and 422.
