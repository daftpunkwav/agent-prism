# `@agentprism/harness`

Neutral execution semantics: context pipeline, prompt assembly, reasoning modes, memory retrieval, verification loop, and tool admission. **Bound to no model SDK** (zero `@langchain/*`, enforced by gates): all interaction with drivers goes through the `contracts` language of `LlmMessage / LlmAdapter / AgentDriver`.

## Subdomains (cohesive directories under `src/`)

| Directory | Responsibility |
|---|---|
| `context/` | Message normalization, truncation, and pipeline: `applyContextPipeline`, `MapContextPolicyRegistry` |
| `prompt/` | Prompt assembly: `prompt-builder`, `assembly`, `MapPromptSectionRegistry`, builtin sections |
| `reasoning/` | Reasoning modes: `reasoning-modes` |
| `verification/` | Judging, reflection, evolution, verification loop, answer extraction (`judge`, `reflect`, `evolve`, `loop`) |
| `memory/` | Retrieval augmentation: `rag` |
| `control/` | Tool admission: `tool-guard` (`ToolAccess`) |
| `execution-context.ts` / `usage.ts` | Execution context and usage accounting |

## Seams

- `AgentExecutionContext` + `applyContextPipeline`: the context seam consumed by driver plugins.
- `MapPromptSectionRegistry` / `MapContextPolicyRegistry`: registries for prompt sections and context policies.
- Drivers register implementations back through `drivers.FrameworkDriverRegistry`; `harness` never imports `drivers`.

## Dependencies

- Runtime: the eight `context-*` leaves (`context-analytics`, `context-budget`,
  `context-chunking`, `context-compaction`, `context-instructions`, `context-mentions`,
  `context-retrieval`, `context-time`) plus `contracts / environment / runtime /
  telemetry`.
- Forbidden: `drivers / tools / providers / @langchain/*` and any upper-layer composer.
