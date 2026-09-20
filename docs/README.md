# Documentation

Documentation for Agent Prism, grouped by purpose. When a document disagrees with the
code, the code and `scripts/check-boundaries.mjs` are authoritative.

> Language: **English** | [简体中文](README.zh.md)

## Architecture

Why the system is built this way.

| Document | Summary |
|---|---|
| [architecture.md](architecture.md) | Capability families, dependency directions, and vocabulary |
| [architecture/overview.md](architecture/overview.md) | Concepts, layer map, key ports, design invariants |
| [architecture/data-flow.md](architecture/data-flow.md) | The three execution surfaces end to end, and where state lands on disk |
| [architecture/sandbox-layers.md](architecture/sandbox-layers.md) | Static analysis, approval gate, and OS write sandbox |
| [architecture/composition-root.md](architecture/composition-root.md) | What `assemble()` wires, in what order, and the startup guards |
| [architecture/package-layout.md](architecture/package-layout.md) | Family and leaf anatomy, dependency rules, name resolution |
| [architecture/decision-register.md](architecture/decision-register.md) | Architectural decisions and the code that enforces them |

## Guides

Extension points and their constraints.

| Document | Summary |
|---|---|
| [guides/getting-started.md](guides/getting-started.md) | Install, configure a provider, run both servers, first comparison |
| [guides/add-a-tool.md](guides/add-a-tool.md) | Built-in tool surfaces and toolset membership rules |
| [guides/add-a-driver.md](guides/add-a-driver.md) | Framework driver leaf, seams, and registration |
| [guides/add-a-dimension.md](guides/add-a-dimension.md) | Comparison dimension vocabulary, catalog, and surfaces |
| [guides/add-a-package.md](guides/add-a-package.md) | Leaf anatomy, registration, and boundary rules |

## Reference

| Document | Summary |
|---|---|
| [reference/http-api.md](reference/http-api.md) | Every route: auth, limits, schemas, SSE semantics |
| [reference/events.md](reference/events.md) | Arena event types, builder stream chunks, and folding |
| [reference/tools.md](reference/tools.md) | Toolsets, built-in tools, MCP, and output-budget helpers |
| [reference/dimensions.md](reference/dimensions.md) | Dimensions, templates, judging, and ablation |
| [reference/configuration.md](reference/configuration.md) | Environment variables, credential references, and the `data/` layout |
| [reference/threads.md](reference/threads.md) | Durable fork and resume threads |

## Operations

| Document | Summary |
|---|---|
| [operations/testing.md](operations/testing.md) | Test tiers, runners, and name resolution |
| [operations/quality-gates.md](operations/quality-gates.md) | Boundaries, check:deps, typecheck, lint, export-test, and i18n gates |
| [operations/runbook.md](operations/runbook.md) | Ports, run modes, storage, and failure modes |

## Related documents

- Root [README.md](../README.md): quick start and package catalog.
- [apps/README.md](../apps/README.md): the two runnable applications.
- [packages/README.md](../packages/README.md) and each leaf `README.md`: package
  responsibilities and seams.
- [tests/README.md](../tests/README.md): test placement rules.
- [SECURITY.md](../SECURITY.md): how to report vulnerabilities privately.
- Root [LICENSE](../LICENSE): the project license.
- `AGENTS.md`: rules for coding agents.
