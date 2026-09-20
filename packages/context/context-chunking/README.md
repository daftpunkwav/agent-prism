# `@agentprism/context-chunking`

Structure-aware text chunking for retrieval ingestion.

- `code`: indentation/brace-aware function/class block splitter for common languages.
- `markdown`: header-hierarchy splitter preserving section paths.
- `text`: CJK-aware sentence/paragraph splitter with overlap windows.
- `chunk`: auto-router by language plus metadata (path, offsets, kind).
- Zero dependencies (pure string algorithms, deterministic).
