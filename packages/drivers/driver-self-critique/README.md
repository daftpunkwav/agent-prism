# `@agentprism/driver-self-critique`

Self-Critique framework driver: a ReAct executor loop with a per-batch critic pass.

- `frameworkId: self_critique`, banner `[Self-Critique]`.
- After every tool batch a tool-free critic call scores progress 0-10; low scores
  inject a redirection message (max 2 critic-forced retries per run).
- Critic verdicts ride `reflect` events so answer extraction stays clean.
- Consumes only the harness seam plus `driver-registry` run support.
