# `@agentprism/tool-symbols`

> 语言：**简体中文** | [English](README.md)

基于正则的代码 symbol 索引：definitions、references 与 dependents。

- `index`：按文件提取 definition，覆盖 function、class、interface、struct、enum 与
  arrow-const，带行号；不使用 parser，降级平滑。
- `query`：exact、prefix、substring 的 symbol 搜索，带词边界的 reference 搜索，以及
  反向依赖即 importer 查询。
- `tool`：只读的 `symbols` 内置 tool，含 defs、refs、search、dependents，三个
  toolset 全开。
- 采用启发式而非 tree-sitter：零依赖、确定性、在语法损坏的文件上仍可用。
  依赖 `contracts` 与 `tool-registry`。
