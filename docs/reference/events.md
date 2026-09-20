# Event contract

The streaming vocabulary is defined once in `packages/contracts/contracts/src/events.ts`
for arena and `packages/contracts/contracts/src/builder.ts` for builder. Everything on
the wire is zod-validated against these schemas.

## Arena events

`ArenaEvent` is discriminated on `type` and has 16 variants.

| `type` | Meaning |
|---|---|
| `thought` | reasoning text |
| `thought_delta` and `thought_end` | streamed thinking |
| `thinking` | thinking content |
| `step_start` | emitted when a driver starts one LLM call, before the first token |
| `action` | tool call |
| `observation` | tool result, truncated at `OBSERVATION_MAX_CHARS = 8000` |
| `tool_progress` | streaming tool progress |
| `file_diff` | emitted after write or edit tools succeed, in all drivers |
| `verify` | verification loop output |
| `reflect` | reflection or deliberation output; the planner and critic ride this too |
| `harness_edit` | harness self-edit |
| `report` | comparison report at the SSE tail |
| `complete` | terminal metrics, where `token_stats` defaults to a derivation from `metrics` |
| `error` | system-level with `pipeline: "system"`, or column-level |
| `token_update` | always carries the full `TokenStats` |

Base fields in `ArenaEventBase`: `pipeline`, which is the display label and aggregation
key; `workspace`, `content`, `tool`, `args`, `result`, `step`, `passed`, `reason`,
`metrics`, `message`, `token_stats`, `turn`, `runId`, `timestamp` in milliseconds from
the runner Clock, and an optional `agentId`.

- `turn` is 1-based, and `0` means unannotated. The runtime-side `stampEvent` backfills
  missing fields, including for hand-written driver events.
- `TokenStats`: `input_tokens`, `output_tokens`, `total_tokens`, `context_window`,
  `max_input_tokens`, `max_output_tokens`, `context_usage_pct`, and `input_usage_pct`.
  Defaults are a context window of 128 000, max input of 120 000, and max output of 2048.
- `PipelineMetrics` adds `success`, `duration_ms`, `tool_calls`, and `steps`.
- Nested subagent and ralph_loop events are consumed internally and never replayed
  upward. Their tokens fold into the parent through `complete`-event metrics.
- Answer extraction for judging reads the last `thought`, or else the last `observation`,
  which is why deliberation must ride `reflect`.
- Shared limits in `contracts/src/arena.ts`: `MAX_HISTORY_CHARS = 24 000`,
  `ARENA_MIN_SELECT = 1`, and `OBSERVATION_MAX_CHARS = 8 000`.

## SSE transport shape

- `POST /api/arena/run` streams event name `"arena"`, and each frame carries one
  `ArenaEvent`. It ends with a terminal `report` event and then closes.
- `POST /api/arena/matrix` streams `"matrix"`: `matrix_progress` frames of
  `{template_id, status, score?, error?}` where status is `started`, `scored`, or
  `failed`, plus a final `matrix_report` with `cells[]` carrying the per-template
  `score {passed, total}`, per-column verdicts, and optional metrics and ablation.
- Abort is honored end to end, and the session books as `cancelled`.
- Errors inside the stream are `error` events on the same channel, so a stream never dies
  silently.

## Builder stream chunks

Builder chunks are discriminated on `stream`.

| `stream` | Payload |
|---|---|
| `trace` | a `BuilderTraceEntry` with `kind` of `llm_request`, `llm_response`, `llm_error`, `session`, `swap`, or `notice`, plus `id`, `seq`, `ts`, `turn`, `title`, `data`, and `durationMs` |
| `event` | a full arena `ArenaEvent` for the turn |
| `turn` | a `BuilderTurnMeta` with `turn`, `runId`, `answer`, `metrics`, and `workspace` |
| `error` | `{message, fatal}` |

The stream always terminates with a `[DONE]` data frame unless the client disconnected.
`BUILDER_MESSAGE_MAX_CHARS = 12 000`.

## Folding on the frontend

`@agentprism/arena-view` turns the raw stream into view state: per-column status, folded
trace, final-answer extraction, and report rendering. It is pure, depends only on
`contracts`, and is shared by the arena page and the builder trace rendering.
