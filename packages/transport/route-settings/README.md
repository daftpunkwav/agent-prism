# `@agentprism/route-settings`

Settings knob and memory-status domain routes.

- `registerSettingsRoutes(app, deps)` mounts `GET` and `PUT /api/settings/knobs`,
  `GET /api/settings/memory`, and `POST /api/settings/memory/clear`.
- Controllers arrive on `HttpApplicationDeps`; an absent controller skips registration so
  a host without the seams still boots.

## Dependencies

- Runtime: `http-runtime`.
