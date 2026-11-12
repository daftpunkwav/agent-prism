# `@agentprism/route-settings`

Settings domain routes: runtime knobs (`GET`/`PUT /api/settings/knobs`), memory status
(`GET /api/settings/memory`, `POST /api/settings/memory/clear`), user skills
(`/api/settings/skills` CRUD + enable toggle), and the managed MCP server list
(`GET`/`PUT /api/settings/mcp`).

- `registerSettingsRoutes(app, deps)` mounts every family it has a controller for;
  an absent controller skips registration so a host without the seams still boots.
- Error-code contract: these hand-validated endpoints answer 400 with a `{detail}`
  body on malformed input (schema-validated routes elsewhere answer 422); skill
  identity conflicts (bundled read-only, duplicate name) answer 409, and a
  persistence failure propagates to the shell's 5xx mapping.

## Dependencies

- Runtime: `http-runtime`.
