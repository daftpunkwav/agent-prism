# `@agentprism/context-chunking`

> 语言：**简体中文** | [English](README.md)

面向检索摄入的结构感知文本分块。

- `code`：对常见语言做感知缩进与括号的 function 与 class 块切分。
- `markdown`：按标题层级切分并保留 section 路径。
- `text`：感知 CJK 的句子与段落切分，带重叠窗口。
- `chunk`：按语言自动路由，附加 metadata，含 path、offsets、kind。
- 零依赖，纯字符串算法，确定性。
