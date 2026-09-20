# `@agentprism/memory-semantic`

Semantic memory: structured facts, conventions, and preferences.

- `recordFact` stores subject/predicate/object facts with confidence.
- Enforces validity windows through `validFrom` and `validUntil`, plus TTL expiry.
- `recallFacts` returns relevant non-expired facts for a query.
- Optional `filePath` persistence and an injected clock in `SemanticMemoryOptions`.

## Dependencies

- Runtime: `contracts / memory-store`.
