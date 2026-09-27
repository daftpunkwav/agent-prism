# `@agentprism/driver-deepagents`

Deep Agents framework driver: the `deepagents` middleware stack — planning tool,
virtual filesystem and subagent delegation — over the LangGraph runtime.

- `frameworkId: deepagents`, banner `[Deep Agents]`.
- Runs the real `createDeepAgent`, with the Arena ChatModel (`llmVendor`) and the
  registry tools bound as LangChain StructuredTools.
- The shared context pipeline and tool drift guard ride the framework's model and
  tool middleware, so the context/harness dimensions behave like the LangChain column.
- The framework reserves its own built-in tool names (`ls`, `read_file`, `write_file`,
  `edit_file`, `delete`, `glob`, `grep`, `execute`, the async-task tools, and `task`) and
  rejects any supplied tool using one of them, so the registry tools behind those names
  are dropped for this column and the framework's own versions serve them instead.
- The framework's filesystem middleware is rooted at the Arena workspace with a read-only
  tool allowlist (`read_file`, `ls`, `glob`, `grep`): exploration reads real files, while
  every write and shell call still goes through `tools.execute` and cannot bypass the
  column's toolset policy.
- deepagents runs the model without token streaming, so the last whole model output
  is emitted as the closing thought block when nothing reached the thought channel
  (the shared `modelOutputText` fallback the LangGraph column uses too).

## Dependencies

- Runtime: `contracts / driver-run-support / driver-langchain / harness`, plus `@langchain/core`, `@langchain/langgraph`, and `deepagents`.
