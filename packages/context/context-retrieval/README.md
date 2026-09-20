# `@agentprism/context-retrieval`

Multi-signal retrieval over chunked workspace content.

- `bm25`: Okapi BM25 scorer with CJK-capable tokenization.
- `fusion`: Reciprocal Rank Fusion across heterogeneous rank lists.
- `mmr`: Maximal Marginal Relevance diversification against redundancy.
- `index`: in-memory chunk index with recency weighting and budgeted build.
- Zero dependencies (pure algorithms, deterministic).
