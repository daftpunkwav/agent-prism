# `@agentprism/context-retrieval`

> 语言：**简体中文** | [English](README.md)

针对分块 workspace 内容的多信号检索。

- `bm25`：Okapi BM25 打分器，支持 CJK 分词。
- `fusion`：跨异构 rank 列表的 Reciprocal Rank Fusion。
- `mmr`：Maximal Marginal Relevance，用于降低冗余、增加多样性。
- `index`：内存 chunk 索引，带 recency 权重与预算化构建。
- 零依赖，纯算法，确定性。
