# Security Policy

## Supported versions

Only the `main` branch receives security fixes. There are no tagged releases yet.

## Reporting a vulnerability

Report privately by email to **daftpunk.wav@outlook.com**. Please do not open
public issues for security reports.

Include a description of the issue, reproduction steps or a proof of concept,
the affected package paths, and your assessment of severity. You will receive
an acknowledgment within 7 days and status updates while a fix is in progress.

## Scope notes

Security-relevant surfaces, in rough priority order:

- **Windows restricted-token sandbox** — `packages/environment/environment`
  (`sandbox-launcher.ts`, `win-sandbox-helper.ts`, `scoped-filesystem.ts`,
  `process-runner.ts`): process isolation, reparse-point/junction traversal,
  hardlink handling, and filesystem scoping.
- **SSRF guard** — `packages/agent/agent/src/tool-access.ts` (`safeFetchUrl`):
  URL validation applied before outbound webfetch requests.
- **Tool access control** — `packages/agent/agent/src/tool-access.ts`:
  tool allowlists and approval gating for agent tool calls.
- **Workspace containment** — `packages/agent/agent/src/run-workspace.ts`:
  path containment for workspace file operations.

Findings outside the surfaces above are equally welcome.
