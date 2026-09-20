# `@agentprism/route-threads`

Agent-thread routes. `registerThreadRoutes` mounts create, list, detail, fork, resume-run, and delete endpoints over the durable `ThreadService`. The transcript and workspace survive restarts, fork branches the workspace, and the resume-run stream uses SSE event name `thread`.

## Dependencies

- Runtime: `application / contracts / http-runtime`.
