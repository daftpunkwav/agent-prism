# Decision register

An index of the load-bearing architectural decisions. Each row states the decision, its
rationale, and the code that enforces it.

| Decision | Rationale | Enforced / embodied by |
|---|---|---|
| No global `ctx` container | Explicit parameter injection and registry instances provide swap-ability without an extra coupling surface | `apps/server/src/assemble.ts` |
| `contracts` is the zero-dependency leaf | Repo-wide vocabulary must not pull in runtime dependencies | `scripts/check-boundaries.mjs`, contracts rule |
| Seams first, backends register | Drivers, tools, and providers are swappable leaves behind `DriverLookup`, `ToolRegistry`, and `ProviderLookup` | `FrameworkDriverRegistry`, `MapToolRegistry`, `ProviderLookupAdapter` |
| Composition hardening gates | Declaration honesty and value-edge cycle detection are CI red lines | `scripts/check-package-deps.mjs` |
| Two-level uniform layout `packages/<family>/<leaf>/` | One shape for every capability; package names are unchanged by the layout | `pnpm-workspace.yaml` glob `packages/*/*` |
| Test-only cross-leaf references declare no devDependencies | Root vitest aliases resolve to `src`; declaring them creates an `ERR_PNPM_TASK_CYCLE` | root `vitest.config.ts` `workspaceAliases()` |
| Sandbox deny-list by default | Irreversible filesystem commands are blocked in the agent chain; this is a guardrail, not a security boundary | `@agentprism/sandbox` `DenyListSandboxPolicy` wired through `beforeExecute` |
| Service-owned session writes | Only the `SessionService` use-case layer writes storage; runs never touch it directly | `ArenaService.run`, `safeSession` |
| Ledger isolation | Ledger pathologies warn and never interrupt the observed run | `safeSession` wrapping in application |
| Client abort maps to `cancelled` | Cancel semantics are distinct from failure | contracts `SessionStatus`, route abort wiring |
| Persist-then-prune for oversized artifacts | Over-budget artifacts are dumped in full to disk with a locator and preview rather than silently lost | `tool-builtins/definitions/spill.ts`, `session/blob-store.ts` |
| `ask_user` records but never blocks | No synchronous human channel exists, so blocking or faking an answer would be misleading | `tool-builtins/definitions/ask-user.ts` |
| `subagent` depth cap 1 and toolset inheritance minus itself | Prevents unbounded recursion and privilege escalation | `agent/agent-execution` live body |
| Credential references `${env:NAME}` | Stored config keeps references; resolved secrets are never written back | `provider-catalog/src/endpoints.ts` `resolveCredentialReference` |
| MCP, skill, and orchestration as dimensions | Each run isolates one variable so comparisons stay single-variable | `DIMENSION_FIELD`, `DimensionCatalog` |
| Loop-architecture drivers share harness seams | Loop differences must be architectural rather than prompt suffixes | `driver-plan-execute` and `driver-self-critique` on `buildSystemUser` and `applyContextPipeline` |
| `apps/web` depends only on `client`, `ui`, and `arena-view` | The frontend stays a thin view over contracts-typed clients | `check-boundaries.mjs` web rule |
| Private packages | Nothing is published | each leaf `package.json`, the `apps/web` i18n gate for UI copy |
