# `@agentprism/harness`

Neutral execution semantics: context pipeline, prompt assembly, reasoning modes, memory retrieval, verification loop, and tool admission. **Bound to no model SDK** (zero `@langchain/*`, enforced by gates): all interaction with drivers goes through the `contracts` language of `LlmMessage / LlmAdapter / AgentDriver`.

## Subdomains (cohesive directories under `src/`)

| Directory | Responsibility |
|---|---|
| `context/` | Message normalization, truncation, and pipeline: `applyContextPipeline`, `MapContextPolicyRegistry` |
| `prompt/` | Prompt assembly: `prompt-builder`, `assembly`, `MapPromptSectionRegistry`, builtin sections |
| `reasoning/` | Reasoning modes: `reasoning-modes` |
| `verification/` | Runner, judging, reflection, evolution, loop, answer extraction: `harness-runner` et al. |
| `memory/` | Retrieval augmentation: `rag` |
| `control/` | Tool admission: `tool-guard` (`ToolAccess`) |
| `execution-context.ts` / `usage.ts` | Execution context and usage accounting |

## Seams

- `AgentExecutionContext` + `applyContextPipeline`: the context seam consumed by driver plugins.
- `MapPromptSectionRegistry` / `MapContextPolicyRegistry`: registries for prompt sections and context policies.
- Drivers register implementations back through `drivers.FrameworkDriverRegistry`; `harness` never imports `drivers`.

## Dependencies

- Allowed: `contracts / environment / runtime / telemetry` (all mostly types / foundation).
- Forbidden: `drivers / tools / providers / @langchain/*` and any upper-layer composer.
