# `@agentprism/driver-langgraph`

LangGraph driver (`LangGraphDriver`, `frameworkId "langgraph"`): reasoning-mode graphs (`react / cot-tool / reflexion / tot`) built on the LangChain bridge leaf.

- One compiled graph per reasoning mode; `self_consistency` loops the react graph N times with a fresh state per attempt, then votes.
- Custom tool nodes run every call through `tools.execute`, and the driver emits the action row before the tool runs, so interactive tools (`ask_user`) surface while they wait.
- Each structural node start is narrated as a `[Phase: <node>]` reflect event (the skeleton loop nodes `agent / execute / tools` stay silent), which is what makes the mode's graph visible in the trace.
- Provider token chunks fill the thought channel; when a model call completes without them, its whole output is emitted as the closing thought block (`modelOutputText`), so the column's answer never depends on chunk-level events.

## Dependencies

- Runtime: `contracts / driver-langchain / driver-run-support / harness`, plus `@langchain/core`, `@langchain/langgraph`.
