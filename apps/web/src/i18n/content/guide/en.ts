/**
 * @file content/guide/en
 * @description English guide content compiled against the zh-CN shape.
 *
 * Responsibilities:
 * - Translate hero, sections, dimension docs, and tables
 *
 * Technical terms, dimension ids, module paths, and inline Markdown stay in
 * original form; missing/extra fields are compile errors via GuideContent.
 */

import type { DimensionId } from "@agentprism/client";
import type { DimDoc, GuideHero, GuideSection, Reality } from "./types";
import type { GuideContent } from "./zh-CN";

const fieldMatrix: Array<{
  dimension: DimensionId;
  type: string;
  defaultValue: string;
  lockedWhen: string;
}> = [
  {
    dimension: "framework",
    type: "string",
    defaultValue: "native",
    lockedWhen: "when comparing framework",
  },
  {
    dimension: "prompt",
    type: "PromptProfile",
    defaultValue: "zero_shot",
    lockedWhen: "when comparing prompt",
  },
  {
    dimension: "reasoning",
    type: "ReasoningMode",
    defaultValue: "react",
    lockedWhen: "when comparing reasoning",
  },
  {
    dimension: "context",
    type: "ContextStrategy",
    defaultValue: "sliding",
    lockedWhen: "when comparing context",
  },
  {
    dimension: "harness",
    type: "HarnessLevel",
    defaultValue: "bare",
    lockedWhen: "when comparing Harness",
  },
  {
    dimension: "temperature",
    type: "float 0–2",
    defaultValue: "From the Provider (snapped to 0 / 0.3 / 0.7 / 1)",
    lockedWhen: "when comparing temperature",
  },
  {
    dimension: "model",
    type: "string",
    defaultValue: "Provider.default_endpoint_id",
    lockedWhen: "when comparing model",
  },
  {
    dimension: "thinking",
    type: "ThinkingLevel",
    defaultValue: "Endpoint default (off when unsupported)",
    lockedWhen: "when comparing thinking",
  },
  {
    dimension: "max_steps",
    type: "int 1–40",
    defaultValue: "10",
    lockedWhen: "when comparing max steps",
  },
  {
    dimension: "toolset",
    type: "ToolsetId",
    defaultValue: "full",
    lockedWhen: "when comparing toolset",
  },
  {
    dimension: "mcp",
    type: "McpPolicy",
    defaultValue: "off",
    lockedWhen: "when comparing MCP",
  },
  {
    dimension: "skill",
    type: "SkillPolicy",
    defaultValue: "on_demand",
    lockedWhen: "when comparing skills",
  },
  {
    dimension: "orchestration",
    type: "OrchestrationMode",
    defaultValue: "direct",
    lockedWhen: "when comparing orchestration",
  },
  {
    dimension: "memory",
    type: "MemoryPolicy",
    defaultValue: "none",
    lockedWhen: "when comparing memory",
  },
];

/** Multi-turn conversation mechanics doc (columns share history; not a PipelineConfig field). Consumed only via overviewSections, not exported. */
const MULTI_TURN_DOC = {
  summary:
    "Arena supports follow-up questions across turns on the same set of comparison columns: every column shares the `messages` conversation history, and only `question` changes per turn. The history excludes the current input; the frontend appends the user/assistant pair after a run succeeds.",
  mechanics: [
    "Request body: `question` (this turn) + `messages[]` (the prior alternating user/assistant history, up to 24 entries).",
    "Every comparison column receives the same `messages` and `question`; only the PipelineConfig differs on the comparison dimension.",
    "Drivers assemble the prompt via `buildInitialMessages(system, user, history)`: System → history → this turn's Human.",
    "SSE events carry `turn` (1-based): the backend derives it as `Math.floor(messages.length / 2) + 1` so the frontend can render turns in segments.",
  ],
  limits: [
    "A single message is capped at 4000 characters; total history is capped at 24000 characters (request validation fails beyond that).",
    "Workspaces persist per column: follow-up turns never reset the files a column has written.",
    "Auto-scoring triggers independently for each turn's final answer; comparison reports can be collapsed per turn.",
  ],
  modules: [
    "packages/contracts/contracts/src/arena.ts · ChatMessage / ArenaRunRequest.messages",
    "packages/harness/harness/src/prompt/assembly.ts · buildInitialMessages",
    "packages/arena/arena-runner/src/runner.ts · history pass-through and turn annotation",
  ],
};

/** Comparison display forms (segmented by turn, not a new comparison dimension). */
const COMPARE_FORMS: Array<{ title: string; body: string }> = [
  {
    title: "Trace collapsed by turn",
    body: "TraceView groups events by the `turn` field: each turn shows that turn's question and every column's Thought / Action / Observation stream. Earlier turns can be collapsed to focus on the current turn's differences.",
  },
  {
    title: "TraceDiff aligned within a turn",
    body: "TraceDiff aligns events across columns step by step within the selected turn: the thought / action / observation of the same step are compared side by side, avoiding cross-turn mixing.",
  },
  {
    title: "Reports summarized per turn",
    body: "Comparison reports keep column-level hard metrics (duration, tokens, tool calls); with multiple turns, scores and metrics are shown per turn, making it easy to observe behavioral drift as the conversation deepens.",
  },
  {
    title: "Non-comparison fields",
    body: "The turn number is SSE display metadata, not a PipelineConfig field, and never appears in the baseline panel. Multi-turn experiments still follow the control-variable method: each turn changes only the comparison dimension while the rest of the baseline stays fixed.",
  },
];

const PIPELINE_STAGES: Array<{
  title: string;
  detail: string;
  module: string;
}> = [
  {
    title: "Request entry",
    detail:
      "The frontend POSTs /api/arena/run carrying dimension, selections, baseline, messages (shared history) and question (this turn). The server caps concurrency with a Semaphore.",
    module: "transport/routes/arena.ts · application/arena-service.ts",
  },
  {
    title: "Route expansion",
    detail:
      "DimensionRouter.route generates a PipelineConfig for each selected option; baseline overrides fill the non-comparison fields; the comparison dimension's field is ignored.",
    module: "arena/router.ts",
  },
  {
    title: "Parallel workers",
    detail:
      "One worker per column; the DriverLookup port fetches the AgentDriver for config.framework; failures collapse into an SSE error without taking down other columns.",
    module: "arena/runner.ts",
  },
  {
    title: "Workspace",
    detail:
      "Each column owns a private disk directory data/runs/<run_id>/<label>/; read/write/edit/bash paths are jailed to that cwd.",
    module: "agent/run-workspace.ts · environment/scoped-filesystem.ts",
  },
  {
    title: "Column assembly",
    detail:
      "Builds the column model (temperature, model and thinking parameters injected per column); buildInitialMessages layers Prompt / reasoning / Harness / context hints.",
    module: "contracts/column-runtime.ts · providers/model-factory.ts · harness/prompt",
  },
  {
    title: "Orchestrated execution",
    detail:
      "Native loop or a thin LC/LG driver; SSE carries tool_progress / file_diff; the trailing report event includes hard metrics + artifacts + narrative.",
    module: "drivers/* · harness/verification/harness-runner.ts · evaluation/report.ts",
  },
  {
    title: "Streaming back",
    detail:
      "LC/LG via astream_events and Native's in-house loop directly produce → thought / action / observation / token_update / complete; the frontend renders the Trace.",
    module: "drivers/event-translation.ts",
  },
  {
    title: "Cleanup",
    detail:
      "When the run ends the workspace is unprotected and the RAG cache is dropped per column; models and tool surfaces are constructed per column with no cross-column state.",
    module: "agent/agent-execution.ts finally",
  },
];

const BASELINE_RULES: Array<{ title: string; body: string }> = [
  {
    title: "UI locking",
    body: "The baseline dropdown for the active comparison dimension is disabled; the collapsed summary lists baselines grouped by pipeline / decoding / endpoint.",
  },
  {
    title: "Backend ignores",
    body: "Baseline resolution skips the field matching the comparison dimension (arena/baseline.ts); even if the request body carries it, it has no effect.",
  },
  {
    title: "Value validation",
    body: "Override values must fall within the value set of that dimension's options, otherwise routing fails — no silent fallback.",
  },
  {
    title: "Type normalization",
    body: "temperature / max_steps are converted from option strings to float / int before being written into PipelineConfig.",
  },
  {
    title: "Relationship with the Provider",
    body: "When not overridden, model_id and temperature default to the Settings-persisted configuration; when comparing the temperature dimension, the request-level global temperature does not flatten the per-column values.",
  },
  {
    title: "Shared multi-turn history",
    body: "messages are identical across columns and do not vary with the comparison dimension; columns diverge only in the PipelineConfig of the current run. History is maintained by the frontend; the backend validates the entry count and total character limit.",
  },
];

const toolsetTable: Array<{
  id: string;
  label: string;
  tools: string;
}> = [
  {
    id: "full",
    label: "All tools",
    tools: "read, write, edit, ls, bash, apply_patch, glob, grep, webfetch, todo_write, ask_user, web_search, run_job, bash_session, subagent, skill, goal, ralph_loop, plan, session_query, symbols, scatter (the coding-agent default surface)",
  },
  {
    id: "edit_run",
    label: "Edit + run",
    tools: "read, write, edit, bash, apply_patch, glob, grep, todo_write, ask_user, run_job, bash_session, subagent, skill, goal, ralph_loop, plan, session_query, symbols, scatter",
  },
  {
    id: "read_only",
    label: "Read-only",
    tools: "read, ls, glob, grep, subagent, skill, ralph_loop, scatter, session_query, symbols",
  },
];

const dimensions: DimDoc[] = [
  {
    id: "framework",
    label: "Framework",
    reality: "full",
    summary:
      "Switches the agent-loop driver (Native / Plan-Execute / Self-Critique / LangChain / LangGraph / AutoGen / CrewAI). Under the same tool surface, the same disk workspace and the same baseline, it compares the behavioral differences between loop implementations.",
    controls:
      "The framework dimension forces react + the full tool surface; ArenaRunner fetches the matching AgentDriver for each column through the DriverLookup port, with Native as the default in-house loop.",
    options: [
      {
        value: "native",
        label: "Native",
        effect: "In-house while loop: sample → tool execution → feed back; reasoning/context/Harness strategies take effect inside the agent package.",
      },
      {
        value: "langchain",
        label: "LangChain",
        effect: "create_agent as a thin wrapper over the same tool registry.",
      },
      {
        value: "langgraph",
        label: "LangGraph",
        effect: "A ReAct StateGraph thin wrapper over the same tool registry.",
      },
      {
        value: "plan_execute",
        label: "Plan-Execute",
        effect: "Planner pass writes numbered steps, then an executor loop works the plan with one budgeted replan (two under reflexion).",
      },
      {
        value: "self_critique",
        label: "Self-Critique",
        effect: "ReAct executor plus a per-batch numeric critic; low scores redirect within a bounded budget.",
      },
      {
        value: "autogen",
        label: "AutoGen",
        effect: "Group chat with LLM speaker selection: coder proposes tool calls, the user proxy executes them, the reviewer critiques; TERMINATE ends the chat.",
      },
      {
        value: "crewai",
        label: "CrewAI",
        effect: "Role crew (researcher / coder / reviewer) running a task pipeline; hierarchical mode delegates via a manager (ARENA_CREWAI_PROCESS).",
      },
    ],
    path: [
      "Non-framework dimensions force framework=native in the router, avoiding prompt-only reasoning differences on LangChain.",
      "ArenaRunner fetches the AgentDriver from the DriverLookup port by config.framework.",
      "Each column's cwd = data/runs/<run_id>/<label>/ on disk; tools read/write/edit/bash are all jailed to that directory.",
    ],
    langChain: "LangChainDriver: a thin create_agent wrapper, same tool registry → LC tools.",
    langGraph: "LangGraphDriver: a minimal ReAct graph + the same tool registry.",
    modules: [
      "packages/agent/agent/src/agent-execution.ts",
      "packages/drivers/driver-native/src/native-driver.ts",
      "packages/drivers/driver-langchain/src/langchain-driver.ts",
      "packages/drivers/driver-langgraph/src/langgraph-driver.ts",
      "packages/drivers/driver-plan-execute/src/plan-execute-driver.ts",
      "packages/drivers/driver-self-critique/src/self-critique-driver.ts",
      "packages/drivers/driver-autogen/src/autogen-driver.ts",
      "packages/drivers/driver-crewai/src/crewai-driver.ts",
      "packages/arena/arena-runner/src/runner.ts",
    ],
    baselineTip: "When measuring Prompt / reasoning / context / Harness, keep the framework baseline native; switch to LC/LG only when comparing the framework dimension itself.",
    caveats: [
      "On the framework dimension the baseline toolset/reasoning is normalized by the router to react + full.",
      "When LangChain / LangGraph are not installed, the corresponding drivers skip registration; native is unaffected.",
    ],
  },
  {
    id: "prompt",
    label: "Prompt",
    reality: "full",
    summary:
      "Switches only the Prompt template layer (system / user_suffix), leaving graph structure, tool binding and context-trimming logic untouched. Ideal for isolating the effect of wording strategy on format compliance, reasoning depth and tool selection.",
    controls:
      "buildPromptParts's profile parameter → PROFILES[profile]; template differences are injected into the system and user segments.",
    options: [
      {
        value: "zero_shot",
        label: "Zero-shot",
        effect: "Base system; no example suffix.",
      },
      {
        value: "few_shot",
        label: "Few-shot",
        effect: "Three complete demonstrations (create and verify, fix a crash, multi-step change) mount into the system prompt; each shows task, tool sequence, observation, and the artifact path.",
      },
      {
        value: "cot_prompt",
        label: "CoT Prompt",
        effect: "The system asks for step-by-step Thought; the user message adds Let’s think step by step.",
      },
      {
        value: "structured",
        label: "Structured",
        effect: "The final answer is restated through one schema-constrained call (plan/files/how_to_run JSON; OpenAI response_format, Anthropic forced tool); on any failure the raw answer stands.",
      },
      {
        value: "terse",
        label: "Terse",
        effect: "Minimal prose, tools first; the difference shows up in token metrics rather than judging.",
      },
    ],
    path: [
      "During column assembly buildSystemUser assembles messages from the config: profile / reasoning / harness / context hints layered segment by segment.",
      "PROFILES is applied first, then the reasoning-mode segment, the Harness segment and the context-strategy hint are layered on top.",
      "So what changes on the prompt dimension is the profile segment; the other layered segments are decided by the baseline.",
      "In multi-turn runs the profile segment is rebuilt each turn, while prior Human/AI messages stay in messages, unaffected by the profile.",
    ],
    langChain: "Same as LangGraph: both assemble via buildSystemUser; the difference is not on the framework side.",
    langGraph: "Same as above.",
    modules: ["packages/harness/harness/src/prompt/prompt-builder.ts", "packages/harness/harness/src/prompt/assembly.ts", "packages/harness/harness/src/structured-finalize.ts", "packages/contracts/contracts/src/structured-output.ts"],
    baselineTip: "When comparing frameworks, structured is useful for checking whether format compliance differs by orchestration; in multi-turn experiments, few_shot shows whether examples are remembered by later turns.",
    caveats: [
      "\"CoT Prompt\" is not the reasoning dimension's CoT+Tool: the former only rewords, the latter rewires LangGraph nodes.",
      "In multi-turn follow-ups the structured template may lose JSON compliance due to history interference; step through the Trace to diagnose.",
    ],
  },
  {
    id: "reasoning",
    label: "Reasoning",
    reality: "full",
    summary:
      "Controls the agent's real control flow (not a Prompt label). Under the Native driver, react / cot_tool / tot / reflexion / self_consistency take different branches; non-framework dimensions always run native.",
    controls:
      "The native driver loop switches phase before and after sampling; tot branches for real (width-independent candidate calls, each scored by its own call, argmax winner), self-consistency runs N independent attempts then majority-votes, and reflexion hard-caps the retry count (reasoning-graphs shares the same semantics).",
    options: [
      {
        value: "react",
        label: "ReAct",
        effect: "agent ↔ tools loop: Thought → Action → Observation.",
      },
      {
        value: "cot_tool",
        label: "CoT+Tool",
        effect: "think → act → tools; reason fully before acting.",
      },
      {
        value: "tot",
        label: "ToT",
        effect: "True branching: ARENA_TOT_WIDTH (default 3) independent candidate calls, each scored by its own call, argmax winner executes.",
      },
      {
        value: "reflexion",
        label: "Reflexion",
        effect: "execute ↔ tools → reflect; may re-enter execution after reflecting.",
      },
      {
        value: "self_consistency",
        label: "Self-Consistency",
        effect: "ARENA_SELF_CONSISTENCY_N (default 5) independent attempts with fresh context each, then majority vote over the answers; native and LangGraph implement it structurally.",
      },
    ],
    path: [
      "Non-framework dimensions force framework=native in the router.",
      "Native loop: cot_tool disables tools on the first round → react; tot runs width branch/score pairs then argmax; reflexion may rerun after reflecting; self-consistency reruns the whole task N times and votes.",
      "Plan-Execute: the planner reshapes by mode (tot branches via independent planner candidates and scores; cot_tool reasons first; reflexion doubles the replan budget).",
      "Self-Critique: reflexion grants one extra critic-forced redirect; other modes share the same bar.",
      "Self-consistency is structural in native and LangGraph; plan_execute / self_critique / langchain keep prompt-level support only (see the capability banner).",
      "The event stream includes thought / action / observation / file_diff / tool_progress.",
    ],
    langChain: "On the framework dimension the LangChain column still uses the react graph; use native for reasoning comparisons.",
    langGraph: "On the framework dimension the LangGraph column is a ReAct shell; use native for reasoning comparisons.",
    modules: [
      "packages/harness/harness/src/reasoning/reasoning-modes.ts",
      "packages/drivers/driver-native/src/native-driver.ts",
      "packages/drivers/driver-langgraph/src/reasoning-graphs.ts",
      "packages/drivers/driver-plan-execute/src/plan-execute-driver.ts",
      "packages/drivers/driver-self-critique/src/self-critique-driver.ts",
    ],
    baselineTip: "Keep the framework baseline native when comparing this dimension; this differs from the Prompt dimension's cot_prompt wording strategy.",
    caveats: [
      "ToT's branching calls (2 × ARENA_TOT_WIDTH) and self-consistency's ×N attempts significantly increase tokens and duration; self-consistency's max_steps applies per attempt (total cost up to N × max_steps calls).",
      "reflexion retries are hard-capped; the reflection segment is visible in the Trace.",
    ],
  },
  {
    id: "context",
    label: "Context",
    reality: "full",
    summary:
      "Controls how the message history is trimmed, summarized or augmented with retrieval before each LLM call. It directly determines whether early-turn information survives in multi-turn conversations — one of the comparison dimensions most tightly coupled to multi-turn experiments.",
    controls:
      "prepareMessagesForLlm(strategy) trims for real; vector/hybrid retrieve workspace snippets before every model call, layered with the Prompt-level strategy copy.",
    options: [
      {
        value: "sliding",
        label: "Sliding window",
        effect: "Keeps the most recent window; extends backward to keep AI tool_calls paired with ToolMessages.",
      },
      {
        value: "summary",
        label: "Summary compression",
        effect: "Overflowing segments are compressed into a summary block, then joined with the recent window.",
      },
      {
        value: "vector",
        label: "Vector retrieval",
        effect: "Window trimming + TF-IDF retrieval over the workspace; snippets are injected as Human messages (avoiding multiple system messages).",
      },
      {
        value: "hybrid",
        label: "Hybrid",
        effect: "Combines summary + vector retrieval.",
      },
      {
        value: "tool_tail",
        label: "Tool-tail pruning",
        effect: "Keeps every turn; bulky tool results are compacted head+tail in place (listings keep heads, logs keep error tails).",
      },
      {
        value: "token_budget",
        label: "Token-budget fit",
        effect: "Fits a global character budget: stale tool results drop first, reasoning last, with a loud [Budget ledger] line.",
      },
    ],
    path: [
      "Prompt assembly injects the strategy explanation copy.",
      "LangChain: messages are trimmed via prepareMessagesForLlm before every model call.",
      "LangGraph: every LLM call inside the graph is trimmed by context_strategy via prepareMessagesForLlm.",
      "sanitize merges/flattens non-leading System messages for Anthropic compatibility.",
      "In multi-turn runs messages grow per turn; the difference between the sliding window and summary strategies shows up from turn 2 onward.",
    ],
    langChain: "Trims for real before each call; layered with the strategy copy.",
    langGraph: "Trims for real on every LLM call inside the graph.",
    modules: [
      "packages/harness/harness/src/context/messages.ts",
      "packages/harness/harness/src/context/tool-tail.ts",
      "packages/harness/harness/src/context/token-budget.ts",
      "packages/harness/harness/src/context/sanitize.ts",
      "packages/harness/harness/src/memory/rag.ts",
      "packages/drivers/driver-langchain/src/langchain-driver.ts",
    ],
    baselineTip: "For long tool chains or multi-turn follow-up tasks, prefer summary / vector / hybrid / tool-tail / token-budget; run at least 3 turns before drawing conclusions.",
    caveats: [
      "vector depends on files already present in the workspace; retrieval is empty on a fresh workspace.",
      "When multi-turn messages are shared, columns with different context strategies produce the same history with different trimming — exactly the effect this dimension is meant to measure.",
      "Summary compression can drop exact numbers or code details; when scoring fails, revisit the compressed turns.",
    ],
  },
  {
    id: "harness",
    label: "Harness",
    reality: "full",
    summary:
      "Layers verification / reflection / self-evolution control loops around every column's driver run, testing whether failures can be auto-corrected.",
    controls:
      "runVerificationLoop wraps driver.run inside agent execution for every framework: failed attempts retry with verify/reflect/self-evolve feedback, and Prompt assembly additionally appends the Harness discipline segment.",
    options: [
      {
        value: "bare",
        label: "Bare run",
        effect: "A single driver execution with no verification retries.",
      },
      {
        value: "verify",
        label: "Verify loop",
        effect: "verify_result after the run, rerunning as-is on failure (at most 2 attempts including the first), on every framework.",
      },
      {
        value: "reflect",
        label: "Reflect loop",
        effect: "reflect_on_failure after failing, injecting the reflection before retrying, on every framework.",
      },
      {
        value: "self_evolve",
        label: "Self-evolve",
        effect: "propose_harness_edit after failing (sanitized against injection), then retry with the modification, on every framework.",
      },
    ],
    path: [
      "runVerificationLoop wraps driver.run inside agent execution: for non-bare levels the answer is extracted → verify → optional reflect/edit → feedback rebuilt before retrying (at most 2 attempts including the first).",
      "The Prompt assembly additionally appends the Harness discipline segment, so loop behavior and wording discipline vary together.",
      "SSE may emit verify / reflect / harness_edit events, displayed segmented by turn.",
      "In multi-turn follow-ups the Harness only governs retries within the current run's turn; it does not accumulate across turns.",
    ],
    langChain: "Same wrapper: the create_agent run is retried through the shared verification loop.",
    langGraph: "Same wrapper: the compiled reasoning graph run is retried through the shared verification loop.",
    modules: [
      "packages/harness/harness/src/verification/loop.ts",
      "packages/agent/agent/src/agent-execution.ts",
    ],
    baselineTip:
      "Harness retries increase per-turn duration and tokens; the ablation rows and step digests distinguish turns from within-turn retries.",
    caveats: [
      "Self-evolution prompt edits are length-capped and sanitized against injection; no arbitrary code is executed.",
      "Retries cost tokens even when they fail; judge deltas in the ablation rows show whether the loop paid off.",
    ],
  },
  {
    id: "temperature",
    label: "Temperature",
    reality: "full",
    summary:
      "The LLM sampling temperature, directly controlling output randomness and exploration. When comparing this dimension, columns differ in temperature while the remaining decoding parameters are pinned by the baseline — ideal for isolating randomness's effect on stability and creativity.",
    controls:
      "Column assembly injects config.temperature via createColumnModel; when this is the comparison dimension, the request-level global temperature is skipped.",
    options: [
      { value: "0", label: "0", effect: "Mostly deterministic." },
      { value: "0.3", label: "0.3", effect: "Light randomness." },
      { value: "0.7", label: "0.7", effect: "Moderate exploration." },
      { value: "1", label: "1.0", effect: "Higher randomness." },
    ],
    path: [
      "Route options are strings, converted to float when written into PipelineConfig.",
      "Priority: the column's config.temperature > the Provider endpoint default.",
      "When comparing this dimension, the ArenaRunRequest.temperature global override is skipped and each column takes effect independently.",
      "In multi-turn runs temperature is re-injected each turn; high-temperature columns usually show worse cross-turn consistency.",
    ],
    langChain: "createColumnModel builds the model from config.temperature.",
    langGraph: "Same as LangChain: the model is fully constructed during column assembly.",
    modules: ["packages/providers/provider-langchain/src/model-factory.ts", "packages/arena/arena-routing/src/router.ts", "packages/arena/arena-runner/src/runner.ts"],
    baselineTip: "Use 0 to reduce sampling noise when comparing frameworks/reasoning; for creative tasks (e.g. copywriting) compare 0.7 vs 1.0.",
    caveats: [
      "The Provider's raw temperature snaps to the nearest tier (0 / 0.3 / 0.7 / 1) as the default baseline.",
      "Temperature 0 does not guarantee full determinism: some Providers still show tiny fluctuations or cache differences.",
    ],
  },
  {
    id: "model",
    label: "Model",
    reality: "full",
    summary:
      "Switches the LLM endpoint (different vendors with different URL/Key, or multiple models over the same connection). Decoding parameters (temperature, Top P, thinking level, etc.) are pinned by the shared baseline, ensuring the comparison measures model capability rather than parameter differences.",
    controls:
      "PipelineConfig.endpoint_id → the endpoint is resolved through the ProviderLookup port; instantiated via createColumnModel.",
    options: [
      {
        value: "(default)",
        label: "Default endpoint",
        effect: "Provider.default_endpoint_id, marked as \"current\" among the options.",
      },
      {
        value: "(other)",
        label: "Other endpoints",
        effect: "The cross-vendor or multi-model slots configured in Settings over the same connection.",
      },
    ],
    path: [
      "Provider configuration persists endpoints → DimensionRouter.syncModelOptionsFromProvider (value=endpoint_id).",
      "When comparing the model dimension, temperature / top_p / max_output_tokens / thinking_level etc. come from the baseline and are identical across columns.",
      "With fewer than 2 endpoints, meta.model_compare_ready=false and the UI disables this dimension.",
      "In multi-turn runs every column's model receives the same messages; differences show up in reasoning and tool-call quality.",
    ],
    langChain: "createColumnModel resolves the connection and model through the ProviderLookup port.",
    langGraph: "Same as LangChain: the endpoint is resolved during column assembly.",
    modules: [
      "packages/contracts/contracts/src/provider.ts · LlmEndpoint / ProviderConfig.endpoints",
      "packages/arena/arena-routing/src/router.ts · syncModelOptionsFromProvider",
      "packages/providers/provider-langchain/src/model-factory.ts",
    ],
    baselineTip: "When comparing other dimensions, keep the endpoint baseline at the default endpoint; when comparing this dimension, pin temperature and thinking level in the baseline to avoid hidden variables.",
    caveats: [
      "Endpoints not registered in Settings never appear in the comparison options.",
      "Duplicate model ids are forbidden under the same base_url+api_format.",
      "Endpoints not marked as thinking-capable fall back to off under any thinking tier.",
      "In cross-vendor comparisons, tool-call format and context-window differences may confound conclusions; keep the task template fixed.",
    ],
  },
  {
    id: "thinking",
    label: "Thinking",
    reality: "full",
    summary:
      "Compares the off / low / medium / high thinking tiers. The model must be marked as thinking-capable in Settings; Anthropic maps budget_tokens, OpenAI-compatible maps reasoning_effort. The thinking stream is displayed on a separate track from the final answer.",
    controls:
      "PipelineConfig.thinking_level + endpoint.thinking_capable → createChatModel injects the thinking parameters.",
    options: [
      { value: "off", label: "Off", effect: "No thinking parameters injected." },
      { value: "low", label: "Low", effect: "Smaller budget / effort." },
      { value: "medium", label: "Medium", effect: "The default middle tier." },
      { value: "high", label: "High", effect: "Larger budget; may raise max_tokens." },
    ],
    path: [
      "Provider configuration: thinking_capable + thinking_level are written into LlmEndpoint.",
      "DimensionRouter gates by capability: incapable → forced off.",
      "providers/thinking injects Anthropic thinking or OpenAI reasoning_effort.",
      "SSE streams thinking as its own event type, displayed separately from thought in the Trace.",
    ],
    langChain: "createChatModel injects the thinking fields according to endpoint capability.",
    langGraph: "Same as LangChain.",
    modules: [
      "packages/providers/provider-capability/src/thinking.ts",
      "packages/providers/provider-langchain/src/model-factory.ts",
      "packages/contracts/contracts/src/provider-types.ts · effectiveThinkingLevel",
    ],
    baselineTip: "Unify the thinking tier via the baseline when comparing models; when comparing this dimension, pin the endpoint and temperature and observe the marginal benefit of the thinking budget on complex reasoning tasks.",
    caveats: [
      "Some proxies handle the reasoning_effort / thinking fields inconsistently; check Provider logs when errors appear.",
      "The thinking stream arrives as a separate SSE thinking event, separate from the final answer; scoring only looks at the final answer.",
      "High thinking tiers significantly increase output_tokens and duration; account for the cost when stacking multi-turn experiments.",
    ],
  },
  {
    id: "max_steps",
    label: "Max Steps",
    reality: "full",
    summary:
      "Caps the agent loop depth to prevent infinite loops and control cost. Native/LangGraph enforce a business budget counted in LLM turns; LangChain has no business-level turn budget and is only approximately bounded by the underlying recursion_limit. Reports always show step counts in LLM-turn terms.",
    controls:
      "Native/LangGraph enforce a hard budget in LLM turns (one model call plus its tool executions is one turn); LangChain has no business turn budget and recursion_limit = max(50, max_steps×5) is the only cap (actual turns ≈ 2.5×max_steps; the 5-step tier is dominated by the floor of 50, about 25 turns). The baseline accepts any in-range integer, plus unlimited (the -1 sentinel) to remove the turn budget entirely: Native loops until the model stops calling tools or the run is aborted, while LC/LG cap the graph at 200 000 steps.",
    options: [
      { value: "5", label: "5 steps", effect: "Ends the loop earlier." },
      { value: "10", label: "10 steps", effect: "Default." },
      { value: "15", label: "15 steps", effect: "Longer tool chains." },
      { value: "20", label: "20 steps", effect: "Allows deeper exploration." },
    ],
    path: [
      "The LangGraph initial state carries config.max_steps.",
      "Reasoning graph nodes end when step_count >= max_steps.",
      "recursion_limit = max(50, max_steps×5): a safety net for LangGraph, the only budget for LangChain; the Native loop converges on the same LLM-turn budget. With unlimited the recursion limit is fixed at 200 000 and Native has no turn cap.",
      "When steps run out the agent may return an incomplete answer; if scoring fails, inspect the last few Trace steps.",
    ],
    langChain: "Constrained mainly by the underlying graph's recursion_limit (no independent business max_steps state).",
    langGraph: "Dual constraint: business max_steps + recursion_limit.",
    modules: [
      "packages/drivers/driver-langgraph/src/langgraph-driver.ts",
      "packages/drivers/driver-langchain/src/langchain-driver.ts",
      "packages/drivers/driver-langgraph/src/reasoning-graphs.ts",
      "packages/drivers/driver-native/src/native-driver.ts",
    ],
    baselineTip: "Use a smaller max_steps (5) to control cost when comparing toolsets; for complex multi-step tasks prefer 15–20 and watch for the ceiling.",
    caveats: [
      "LangChain and LangGraph count steps with slightly different semantics; verify the Trace step by step in cross-framework comparisons.",
      "Each follow-up turn counts steps independently; tool calls from earlier turns do not count toward the current turn's max_steps.",
    ],
  },
  {
    id: "toolset",
    label: "Toolset",
    reality: "full",
    summary:
      "Filters the list of tools actually bound to the model (not a wording hint). It decides which Tool schemas the agent can call, directly affecting the tasks it can complete and the risk of mis-calls.",
    controls:
      "config.toolset → selectToolNames filters the bound tool set (toLangchainTools); fixed at column assembly with no cross-column shared state.",
    options: toolsetTable.map((t) => ({
      value: t.id,
      label: t.label,
      effect: t.tools,
    })),
    path: [
      "Column assembly filters the tool surface by config.toolset (tools/toolset).",
      "LangGraph: in-graph tool binding and the tool node use the same filtered set.",
      "LangChain: create_agent binds only the filtered tools.",
      "Each column's tool surface is constructed independently, so columns are isolated by design.",
      "In multi-turn runs the disk workspace persists across turns; read_only vs edit_run differ significantly on multi-turn file tasks.",
    ],
    langChain: "create_agent only sees the filtered tool schemas.",
    langGraph: "bind_tools and execution lookup share the same active set.",
    modules: [
      "packages/tools/tool-registry/src/toolset.ts",
      "packages/agent/agent/src/agent-execution.ts",
      "packages/harness/harness/src/control/tool-guard.ts",
    ],
    baselineTip: "Use full or edit_run as the baseline for coding tasks; on the framework dimension the toolset is normalized to full.",
    caveats: [
      "The model may still talk about unbound tools; actual calls fail because they are unbound or fall into an unknown-tool branch.",
      "tool_guard and toolset are two independent layers: the former intercepts off-task calls, the latter limits the available set.",
    ],
  },
  {
    id: "mcp",
    label: "MCP",
    reality: "full",
    summary:
      "Bridges in-process MCP capability servers (filesystem, fetch) into the column tool list, testing whether MCP-attached tools change what the agent accomplishes versus builtins alone.",
    controls:
      "config.mcp_policy selects the attachment: off attaches nothing, fs bridges the filesystem server, full adds the fetch server (fetch joins the full toolset only).",
    options: [
      {
        value: "off",
        label: "MCP off (builtins only)",
        effect: "No MCP tools; the model works from the toolset-filtered builtins.",
      },
      {
        value: "fs",
        label: "MCP filesystem server",
        effect: "Adds mcp__fs_list / mcp__fs_read on every toolset.",
      },
      {
        value: "full",
        label: "MCP filesystem + fetch",
        effect: "Adds the filesystem server plus mcp__fetch_url (full toolset only).",
      },
    ],
    path: [
      "Agent assembly registers MCP tools into the column registry after toolset filtering; explicit tool-name overrides stay authoritative and never gain MCP tools.",
      "The ablation rows report mcp_share per column, so MCP usage versus judging deltas is directly readable.",
      "The system prompt grounds the attachment with an explicit MCP line.",
    ],
    langChain: "MCP tools ride the same registry bridge as builtins; create_agent sees them as ordinary tools.",
    langGraph: "Same bridge: graph tool nodes execute MCP tools through the shared registry.",
    modules: [
      "packages/tools/tool-mcp/src/servers.ts",
      "packages/tools/tool-mcp/src/bridge.ts",
      "packages/agent/agent/src/agent-execution.ts",
    ],
    baselineTip: "Compare off vs fs on a file-listing task first; add full only when the task genuinely needs fetching.",
    caveats: [
      "MCP servers run in-process against the column workspace: no sockets, no external processes.",
      "mcp__ names in the Trace mark exactly which calls the MCP bridge served.",
    ],
  },
  {
    id: "skill",
    label: "Skill",
    reality: "full",
    summary:
      "Controls how expert runbooks reach the model: disabled, on-demand through the skill tool, or preloaded into the prompt; testing whether skill loading changes outputs.",
    controls:
      "config.skill_policy gates the skill tool (off removes it) and, for preloaded, injects the bundled runbook block into the system prompt.",
    options: [
      {
        value: "off",
        label: "Skills disabled",
        effect: "The skill tool is removed; the model works from the base prompt only.",
      },
      {
        value: "on_demand",
        label: "On-demand via skill tool",
        effect: "The model lists skills first, then reads matching runbooks before acting.",
      },
      {
        value: "preloaded",
        label: "Preloaded into prompt",
        effect: "Bundled runbooks ride the system prompt; the skill tool stays for workspace overrides.",
      },
    ],
    path: [
      "Bundled runbooks ship as embedded constants; workspace .skills/<name>/SKILL.md overrides same-named bundled entries.",
      "Preloading flows through the execution context so every driver inherits it via buildSystemUser.",
      "The ablation rows report skill_reads per column alongside judging deltas.",
    ],
    langChain: "Same skill tool and preload block; no LC-specific path.",
    langGraph: "Same skill tool and preload block; no graph-specific path.",
    modules: [
      "packages/tools/tool-builtins/src/definitions/skills.ts",
      "packages/tools/tool-builtins/src/definitions/skill.ts",
      "packages/harness/harness/src/prompt/assembly.ts",
    ],
    baselineTip: "Compare off vs preloaded on a conventions task (e.g. commit-message format) where runbook knowledge is decisive.",
    caveats: [
      "Skills never auto-inject except under preloaded; on_demand keeps context lean by design.",
      "Malformed workspace skills are skipped with a loud count, never silently.",
    ],
  },
  {
    id: "orchestration",
    label: "Orchestration",
    reality: "full",
    summary:
      "Selects the execution discipline: free-form direct runs versus plan-first (write the plan, then execute it) versus goal-first (track an explicit objective); testing how plan and goal discipline change task completion.",
    controls:
      "config.orchestration seeds a plan doc (plan_first) or a goal doc (goal_first) into fresh workspaces and appends the matching discipline line to the system prompt.",
    options: [
      {
        value: "direct",
        label: "Direct execution",
        effect: "No seeding, no discipline line; the model works free-form.",
      },
      {
        value: "plan_first",
        label: "Plan-first",
        effect: "Seeds .agent-plan.md and instructs the model to propose via the plan tool before editing.",
      },
      {
        value: "goal_first",
        label: "Goal-first",
        effect: "Seeds .agent-goal.json and instructs the model to set objective plus done criteria first.",
      },
    ],
    path: [
      "Seeding happens on fresh workspaces only; follow-up turns keep the plan/goal the agent already wrote.",
      "A seed failure never fails the run it was meant to discipline; the prompt line still applies.",
      "Plan/goal artifacts persist in the workspace and ship in the report artifacts tab.",
    ],
    langChain: "Same seeding and prompt line; the discipline is framework-neutral.",
    langGraph: "Same seeding and prompt line; the discipline is framework-neutral.",
    modules: [
      "packages/agent/agent/src/agent-execution.ts",
      "packages/tools/tool-builtins/src/definitions/plan.ts",
      "packages/tools/tool-builtins/src/definitions/goal.ts",
    ],
    baselineTip: "Compare the three on a two-artifact chore and read artifacts plus ablation delegations, not just the DONE marker.",
    caveats: [
      "There is no human approval gate: propose records the plan and the run proceeds (durable half, not the approval half).",
      "A blocked goal without a reason is rejected: blocking must state what unblocks.",
    ],
  },
  {
    id: "memory",
    label: "Memory",
    reality: "full",
    summary:
      "Cross-session memory mounting: episodic mounts past task post-mortems (outcomes and lessons), semantic mounts project facts and conventions; testing whether solving with recalled experience lowers step counts and token cost.",
    controls:
      "config.memory decides what a top-level run mounts: recall hits are rendered by renderMemoryBlock into a [Prior Experience & Relevant Memories] system prompt section; after every top-level run one episodic post-mortem is distilled and written back (both the success and the failure path settle).",
    options: [
      {
        value: "none",
        label: "No memory",
        effect: "Nothing mounted, nothing written back; every run is a stateless first attempt.",
      },
      {
        value: "episodic",
        label: "Past experience",
        effect: "Recalls up to 3 past post-mortems for the task and mounts them as experience lines; writes back this run's post-mortem when it ends.",
      },
      {
        value: "semantic",
        label: "Project facts",
        effect: "Recalls up to 5 project facts/conventions for the query; writes no experience back.",
      },
      {
        value: "full",
        label: "Full",
        effect: "Mounts episodic + semantic together (3 + 5 line caps); writes back the episodic post-mortem when it ends.",
      },
    ],
    path: [
      "Top-level runs only: nested subagent turns share files but never recall again; the parent column already carries the memory.",
      "Recall and write-back are best-effort: a missing or failing memory service warns and continues stateless, never failing the run.",
      "Unknown tokens fail closed to stateless; experience lines are synthesized from keyActions (up to 12 tool names) plus a 500-char task summary, and each prompt line is truncated to 300 chars.",
    ],
    langChain: "The same mounting and write-back logic; memory is framework-neutral.",
    langGraph: "The same mounting and write-back logic; memory is framework-neutral.",
    modules: [
      "packages/agent/agent/src/agent-execution.ts · recallMemoryForRun / recordEpisodicExperience",
      "packages/harness/harness/src/prompt/assembly.ts · renderMemoryBlock",
      "packages/contracts/contracts/src/memory-port.ts · MemoryServicePort",
      "packages/memory/memory-service/src/memory-service-adapter.ts · MemoryServiceAdapter",
    ],
    baselineTip: "Run the same task twice comparing none against full and watch whether the second round's steps/tokens drop; recall quality depends on similar earlier tasks having been recorded.",
    caveats: [
      "Stores persist at data/memory_episodic.json and data/memory_semantic.json; a failed or missing store degrades the run to stateless (best-effort), never failing the run.",
      "Builder pins memory=none; memory exists only as an Arena comparison dimension.",
      "Write-back distills one post-mortem per run (task, tools, outcome, lessons), never the full intermediate trajectory.",
    ],
  },
];

const HONESTY: Array<{ title: string; body: string }> = [
  {
    title: "Multi-turn conversation",
    body: "messages are shared across columns and do not vary with the comparison dimension; turn is SSE display metadata, not a PipelineConfig field. When comparing Traces/reports per turn, confirm that each turn's baseline matches the comparison dimension.",
  },
  {
    title: "Reasoning × LangChain",
    body: "Reasoning comparisons force native; the LangChain column only appears on the framework dimension, always with react + the full tool surface.",
  },
  {
    title: "Multiple endpoints",
    body: "The Arena model dimension switches among the LLM endpoints configured in Settings (cross-vendor URL/Key, or multiple models on one connection). Temperature / Top P / thinking level are pinned by the shared baseline. Fewer than 2 endpoints cannot be compared.",
  },
  {
    title: "Thinking-capability gating",
    body: "Models not marked as thinking-capable in Settings are forced to off no matter which tier the baseline or comparison selects; the thinking stream is shown as a separate SSE thinking event.",
  },
  {
    title: "Context hint copy",
    body: "Beyond prepareMessagesForLlm's real trimming, strategy explanation copy is layered on top.",
  },
  {
    title: "Harness dual channel",
    body: "Control loops retry for real; meanwhile Prompt assembly appends the Harness copy.",
  },
  {
    title: "prompt_version",
    body: "A reserved PipelineConfig field, unread by the current execution path; it cannot serve as a comparison dimension.",
  },
  {
    title: "Tool guardrail",
    body: "tool_guard can intercept off-task tool_calls; it is a separate layer from toolset filtering.",
  },
];

/** Overview and boundaries sections: ids serve the TOC, hero quick links, and anchors simultaneously (single source; never duplicate in the view). */
const overviewSections: GuideSection[] = [
  {
    id: "method",
    title: "Control-variable method",
    group: "overview",
    lead:
      "Each experiment lets **one field** vary across columns (the comparison dimension) while every other field shares one baseline. Only then can the report's duration, tokens, tool calls and scores be attributed to the dimension under test.",
    blocks: [
      {
        kind: "formula",
        cards: [
          { tag: "Comparison dim", text: "Varies across columns", code: "selections[] → field" },
          { tag: "Baseline", text: "Fixed across columns", code: "baseline → other fields" },
          { tag: "Output", text: "One PipelineConfig per column", code: "Adapter.run × N" },
        ],
        operators: ["+", "→"],
      },
      {
        kind: "note",
        text: "Routing: `DimensionRouter.route(dimension, selections, baseline)` · Mapping: `DIMENSION_FIELD`",
      },
    ],
  },
  {
    id: "multi-turn",
    title: "Multi-turn conversation and per-turn comparison",
    group: "overview",
    lead: MULTI_TURN_DOC.summary,
    blocks: [
      { kind: "steps", heading: "How it works", items: MULTI_TURN_DOC.mechanics },
      { kind: "bullets", heading: "Constraints and limits", items: MULTI_TURN_DOC.limits },
      { kind: "cards", items: COMPARE_FORMS },
      { kind: "codeList", heading: "Code entry points", items: MULTI_TURN_DOC.modules },
    ],
  },
  {
    id: "field-matrix",
    title: "Field matrix",
    group: "overview",
    lead:
      "The fourteen comparison dimensions map one-to-one onto `PipelineConfig` fields, and all of them can also appear in the baseline panel. Multi-turn history travels via `ArenaRunRequest.messages` and is not a comparison dimension.",
    blocks: [{ kind: "fieldMatrix" }],
  },
  {
    id: "baseline",
    title: "Baseline mechanics",
    group: "overview",
    lead: "The baseline is an override write to non-comparison fields. Frontend locking and backend validation must agree; invalid values fail hard.",
    blocks: [
      { kind: "cards", items: BASELINE_RULES },
      { kind: "note", text: "`BaselineOverrides` → `resolveBaselineOverrides` → `buildPipelineBase`" },
    ],
  },
  {
    id: "pipeline",
    title: "Single-run pipeline",
    group: "overview",
    blocks: [{ kind: "stages", items: PIPELINE_STAGES }],
  },
  {
    id: "toolsets",
    title: "Toolset details",
    group: "overview",
    lead: "`toolset` is filtered via `selectToolNames` before the real `bind_tools` / `create_agent` — the bound set is what counts.",
    blocks: [{ kind: "toolsetGrid" }],
  },
  {
    id: "honesty",
    title: "Honest boundaries",
    group: "boundary",
    lead: "Deliberately understated: avoid misreading wording differences as orchestration differences.",
    blocks: [{ kind: "cards", items: HONESTY }],
  },
];

/** Page hero copy and config (metric counts derive from this module's content arrays; numbers are never handwritten). */
const hero: GuideHero = {
  eyebrow: "OPTICAL BENCH · REFERENCE",
  title: "Dimensions & Baselines",
  lead: "A structured reference for the control-variable method: how fields map, how baselines lock, whether the fourteen comparison dimensions take real effect across frameworks, and how multi-turn conversations are compared turn by turn.",
  actions: [
    { href: "/arena", label: "Open Arena", icon: "flask", variant: "primary" },
    { href: "/learn", label: "Learning Path", icon: "arrow", variant: "ghost" },
  ],
  pillars: [
    { kicker: "Pipeline", text: "Decoding · endpoint layering, side by side" },
    { kicker: "Baseline", text: "Locks every field outside the comparison dimension" },
    { kicker: "Multi-turn", text: "Shared messages, segmented by turn" },
    { kicker: "Trace", text: "Column-aligned Thought / Action comparison" },
  ],
  metrics: [
    { label: "Comparison dimensions", count: dimensions.length },
    { label: "Field mappings", count: fieldMatrix.length },
    { label: "Toolset presets", count: toolsetTable.length },
  ],
  dimChipLimit: 6,
};

/** Copy of the dimension-details index area. */
const dimIndexDoc = {
  eyebrow: "Dimension details",
  note: "Uniform structure: what it controls → options → path → LC/LG → code → baseline tips → caveats",
};

type TocGroupId = "overview" | "dimensions" | "boundary";

const TOC_GROUP_ORDER: readonly TocGroupId[] = ["overview", "dimensions", "boundary"];

const TOC_GROUP_TITLES: Record<TocGroupId, string> = {
  overview: "Overview",
  dimensions: "Dimensions",
  boundary: "Boundaries",
};

/** The TOC derives from the section and dimension arrays, keeping anchor ids single-sourced and never out of sync with the rendered sections. */
const tocGroups: Array<{
  title: string;
  items: Array<{ id: string; label: string }>;
}> = TOC_GROUP_ORDER.map((group) => ({
  title: TOC_GROUP_TITLES[group],
  items:
    group === "dimensions"
      ? dimensions.map((d) => ({ id: d.id, label: d.label }))
      : overviewSections.filter((s) => s.group === group).map((s) => ({
          id: s.id,
          label: s.title,
        })),
}));

/** Badge copy per reality level. */
const realityLabel: Record<Reality, string> = {
  full: "Fully effective",
  partial: "Framework-dependent",
  "prompt-only": "Prompt-only",
};

/** The single guide content object for en; structurally identical to the zh-CN source of truth. */
export const guideContent: GuideContent = {
  realityLabel,
  fieldMatrix,
  toolsetTable,
  dimensions,
  overviewSections,
  hero,
  dimIndexDoc,
  tocGroups,
};
