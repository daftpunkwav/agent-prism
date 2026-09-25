# drivers/

Framework-adapter layer for execution semantics: a run column can execute on any supported framework. `driver-run-support` owns the `DriverLookup` seam and shared run support; each backend leaf adapts exactly one framework and is registered explicitly at the single composition root (`apps/server/src/assemble.ts`). Heavy framework dependencies live only in backend leaves; the seam and the native backend stay LangChain-free.

## Subpackages

| Package | Role | Wired at |
|---|---|---|
| [`driver-run-support/`](driver-run-support/README.md) | Driver services: `DriverLookup` registry, best-effort registration helper, shared run support (event translation, capability banner, recursion cap) | Seam (zero backend dependencies) |
| [`driver-native/`](driver-native/README.md) | In-process native driver, no external framework | Registered into `DriverLookup` as `native` |
| [`driver-langchain/`](driver-langchain/README.md) | LangChain driver; owns the LC/message bridge | Registered into `DriverLookup` as `langchain` |
| [`driver-langgraph/`](driver-langgraph/README.md) | LangGraph reasoning-graph driver | Registered into `DriverLookup` as `langgraph` |
| [`driver-plan-execute/`](driver-plan-execute/README.md) | Plan-Execute driver: planner pass plus a ReAct executor with one budgeted replan | Registered into `DriverLookup` as `plan_execute` |
| [`driver-self-critique/`](driver-self-critique/README.md) | Self-Critique driver: a tool-less critic scores each tool batch and redirects | Registered into `DriverLookup` as `self_critique` |
| [`driver-autogen/`](driver-autogen/README.md) | AutoGen-pattern driver: group chat with LLM speaker selection | Registered into `DriverLookup` as `autogen` |
| [`driver-crewai/`](driver-crewai/README.md) | CrewAI-pattern driver: role crew running a task pipeline | Registered into `DriverLookup` as `crewai` |
