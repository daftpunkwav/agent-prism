# `@agentprism/session-title`

Deterministic session titles with an LLM-hook port.

- `normalize`: trim/collapse/cap title text with a stable fallback chain.
- `title`: first-prompt squeeze plus keyword fallback; `Titler` port for
  model-generated titles with deterministic fallback on failure.
- Depends on `contracts` session vocabulary (types only).
