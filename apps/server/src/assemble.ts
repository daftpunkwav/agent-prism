/**
 * @file assemble
 * @description Composition root: the only place drivers are registered and wiring happens.
 *
 * Responsibilities:
 * - Register drivers and infrastructure adapters into application services
 * - Produce the RuntimeComponents bundle consumed by main/server
 *
 * Composition happens once here; main/server only listen after this returns.
 */

import path from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  ArenaLogsService,
  ArenaService,
  FileThreadStore,
  MatrixService,
  ProjectStore,
  ProviderService,
  ThreadService,
  WorkspaceFileService,
} from "@agentprism/application";
import { buildComparisonReport, extractNarrativeText, judgeAnswers, judgeAnswersAsync, type ReportDeps } from "@agentprism/evaluation";
import { registerContextStrategyPlugins } from "@agentprism/harness";
import { contextAssemblyPlugins } from "@agentprism/context-assembly";
import type { ContextTuning } from "@agentprism/harness";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  configureUserSkills,
  createBuiltinToolRegistry,
  createUserSkill,
  deleteUserSkill,
  listSkillsForSettings,
  setSkillEnabled,
  updateUserSkill,
} from "@agentprism/tool-builtins";
import { DimensionCatalog } from "@agentprism/dimensions";
import {
  DimensionRouter,
  ProviderDimensionSync,
  buildCapabilityOptionProjection,
} from "@agentprism/arena-dimensions";
import { ArenaRunner } from "@agentprism/arena-runner";
import { McpServersStore, parseMcpServersEnv, type McpServerConfig } from "@agentprism/tool-mcp";
import type { HttpApp } from "@agentprism/http-runtime";
import { mountDomainRoutes } from "./mount-routes.js";
import { registerFrameworkDrivers } from "./load-drivers.js";
import {
  EndpointCatalog,
  ProviderConfigStore,
  ProviderLookupAdapter,
  endpointUpdateToEntity,
  lookupEndpoint,
  mergeEndpointKeys,
  parseProviderConfig,
  resolveDefaultEndpoint,
  toPublicProviderConfig,
} from "@agentprism/provider-catalog";
import {
  createChatModel,
  createColumnRuntime,
  createLlmWireTraceHandler,
  testProviderConnection,
} from "@agentprism/provider-langchain";
import { EpisodicMemory } from "@agentprism/memory-episodic";
import { SemanticMemory } from "@agentprism/memory-semantic";
import { MemoryServiceAdapter } from "@agentprism/memory-service";
import { AtomicJsonFile, NodeAppendFile, atomicWriteJson, readJsonFile } from "@agentprism/persistence";
import { SessionService } from "@agentprism/application";
import { FileBlobStore, FileSessionStore } from "@agentprism/session-persistence";
import { RandomIdGenerator, SystemClock, WorkspaceRegistry } from "@agentprism/runtime";
import {
  BUILDER_SESSIONS_PATH,
  BUILDER_TRACES_DIR,
  DATA_DIR,
  MCP_SERVERS_PATH,
  MEMORY_EPISODIC_PATH,
  MEMORY_SEMANTIC_PATH,
  RUNTIME_KNOBS_PATH,
  SESSIONS_PATH,
  SKILL_SETTINGS_PATH,
  THREADS_PATH,
  USER_SKILLS_DIR,
  defaultRuntimeKnobs,
  RUNTIME_KNOB_FIELDS,
  RuntimeKnobsStore,
  loadSettings,
  PROVIDER_CONFIG_PATH,
  PROJECTS_PATH,
  RUNS_DIR,
  toLlmEnvSeed,
  type LlmEnvSeed,
  type RuntimeKnobs,
  type Settings,
} from "@agentprism/config";
import {
  BuilderService,
  BuilderSessionStore,
  SessionTraceStore,
} from "@agentprism/builder-service";
import {
  type BuilderModelRuntimeFactory,
} from "@agentprism/builder-turns";
import type {
  AnswerJudge,
  BuilderEndpointBlock,
  ColumnRuntimeFactory,
  PipelineConfig,
  ProviderCommand,
  ReportPublisher,
} from "@agentprism/contracts";
import { isLoopbackHost } from "@agentprism/contracts";

// Custom-dimension subpackages: register at composition root so the context
// dimension auto-surfaces them (ARENA_CUSTOM_DIMENSIONS=off disables).
if (process.env.ARENA_CUSTOM_DIMENSIONS !== "off") {
  registerContextStrategyPlugins(contextAssemblyPlugins);
}

export interface RuntimeComponents {
  settings: Settings;
  app: HttpApp;
  /** Debounced durable-store flush (threads, builder sessions, trace journals): awaited on shutdown so the last committed turn survives. */
  flushDurableStores: () => Promise<void>;
}

const REQUIRED_CAPABILITY_DIMS = ["prompt", "reasoning", "context", "harness", "toolset"] as const;

/**
 * Assembles the full server host. Fail-fast when required capability seams have
 * zero registered options, or when no driver is available.
 *
 * @returns Settings plus the composed HTTP application (single composition root;
 *   main/server only listen after this resolves).
 * @throws Error on non-loopback hosts without API_TOKEN, or on missing seams/drivers.
 */
export async function assemble(): Promise<RuntimeComponents> {
  const settings = loadSettings();

  // Non-loopback listening requires an API token; refuse to start otherwise.
  // Loopback set shared with the URL policy (contracts isLoopbackHost): ::1 was
  // previously misclassified as remote, forcing a token on IPv6 loopback.
  const loopbackOnly = isLoopbackHost(settings.backendHost);
  if (!loopbackOnly && settings.apiToken === "") {
    throw new Error("API_TOKEN is required when listening on a non-loopback address (0.0.0.0/::)");
  }
  if (loopbackOnly && settings.apiToken === "") {
    console.warn("[server] API_TOKEN is empty: the API is unauthenticated (acceptable for loopback-only local use)");
  }

  const clock = new SystemClock();
  const idGenerator = new RandomIdGenerator();
  const envSeed: LlmEnvSeed = toLlmEnvSeed(settings);
  const providerStore = new ProviderConfigStore({
    file: new AtomicJsonFile(PROVIDER_CONFIG_PATH),
    envSeed,
    idGenerator,
  });
  const endpointCatalog = new EndpointCatalog();
  const providerLookup = new ProviderLookupAdapter(providerStore, endpointCatalog);
  const dimensionCatalog = new DimensionCatalog();
  const workspaceRegistry = new WorkspaceRegistry({
    runsRoot: RUNS_DIR,
    clock,
    maxWorkspaces: settings.maxWorkspaces,
    ttlSeconds: settings.workspaceTtlSeconds,
    lruActiveWindowSeconds: settings.workspaceLruWindowSeconds,
  });
  const providerSync = new ProviderDimensionSync({ dimensionCatalog, providerLookup });
  const router = new DimensionRouter({
    dimensionCatalog,
    providerSync,
  });

  providerStore.addChangeListener(() => {
    try {
      router.invalidateProviderCache();
    } catch (error) {
      console.warn(`[assemble] Provider cache invalidate failed (will retry on next request): ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const reportDeps: ReportDeps = {
    workspaceRegistry,
    // LC adaptation for the narrative stays at the composition root: evaluation
    // only sees a system+user → text seam, blocks are flattened here.
    createNarrative: async ({ system, user, signal }) => {
      const model = createChatModel({
        provider: providerStore.load(),
        catalog: endpointCatalog,
        timeoutMs: llmCallOptions().timeoutMs,
        maxRetries: llmCallOptions().maxRetries,
      });
      const response = await model.invoke([new SystemMessage(system), new HumanMessage(user)], { signal });
      return extractNarrativeText(response.content);
    },
    dimensionLabel: (field: string) => dimensionCatalog.fieldDisplayLabel(field),
  };

  const reportPublisher: ReportPublisher = {
    publish: (input) =>
      buildComparisonReport(
        reportDeps,
        input.request,
        input.configs,
        input.eventsByPipeline,
        input.metricsByPipeline,
        { signal: input.signal },
      ),
  };

  const modelFactory: ColumnRuntimeFactory = {
    create(config: PipelineConfig, options) {
      // Same wire tracer as builder sessions: arena run logs capture every column's
      // LLM request/response without driver changes (native included — the adapter
      // and the vendor model share one BaseChatModel instance).
      const callbacks = options?.wireSink
        ? [createLlmWireTraceHandler({ sink: options.wireSink, now: () => clock.now() })]
        : undefined;
      return createColumnRuntime({ provider: providerStore.load(), catalog: endpointCatalog }, config, {
        callbacks,
        timeoutMs: llmCallOptions().timeoutMs,
        maxRetries: llmCallOptions().maxRetries,
      });
    },
  };

  const providerCommand: ProviderCommand = {
    toPublic: toPublicProviderConfig,
    mergeEndpointKeys,
    endpointUpdateToEntity,
    parseConfig: (raw, ids) => parseProviderConfig(raw, envSeed, ids),
    testConnection: (provider, target) =>
      testProviderConnection({ provider, catalog: endpointCatalog, idGenerator }, target),
  };

  // Judge-model resilience policy (composition root owns the tuning): the model
  // carries the single timeout + retry layer (createChatModel wires the same
  // knobs into both vendor SDKs), so one hung verdict cannot stall the judge
  // endpoint and transient provider faults retry boundedly. No outer retry/
  // timeout wrappers here: they would multiply the same policy into up to 9
  // wire calls per verdict (3 SDK attempts x 3 outer rounds).
  const judgeInvoke = async (prompt: string): Promise<string> => {
    const model = createChatModel({
      provider: providerStore.load(),
      catalog: endpointCatalog,
      timeoutMs: llmCallOptions().timeoutMs,
      maxRetries: llmCallOptions().maxRetries,
    });
    const response = await model.invoke(prompt);
    const content = response.content;
    if (typeof content === "string") return content;
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  };

  const answerJudge: AnswerJudge = {
    judgeAnswers,
    judgeAnswersAsync: (answers, spec, context) =>
      judgeAnswersAsync(answers, spec, { invoke: judgeInvoke }, context),
  };

  // Eager driver registration: fail-fast before listen when no driver is available.
  const registry = await registerFrameworkDrivers();
  const available = registry.listAvailable();

  // Agent Builder: model runtime attaches the LLM wire tracer so every driver is
  // observed without driver changes; endpoint blocks come from the live provider config.
  const builderModelRuntime: BuilderModelRuntimeFactory = {
    create(config: PipelineConfig, wire) {
      const callbacks = [
        createLlmWireTraceHandler({
          sink: wire.sink,
          now: () => clock.now(),
          boundToolNames: wire.boundToolNames,
        }),
      ];
      return createColumnRuntime({ provider: providerStore.load(), catalog: endpointCatalog }, config, {
        callbacks,
        timeoutMs: llmCallOptions().timeoutMs,
        maxRetries: llmCallOptions().maxRetries,
      });
    },
  };
  const builderEndpoints = (): BuilderEndpointBlock[] =>
    toPublicProviderConfig(providerStore.load()).endpoints.map((endpoint) => ({
      id: endpoint.id,
      name: endpoint.label !== "" ? endpoint.label : endpoint.provider_name !== "" ? endpoint.provider_name : endpoint.id,
      model: endpoint.model,
      api_format: endpoint.api_format,
      thinking_capable: endpoint.thinking_capable,
    }));
  const builderStore = new BuilderSessionStore({
    file: new AtomicJsonFile(BUILDER_SESSIONS_PATH),
    idGenerator,
    clock,
    flushDebounceMs: settings.fileFlushDebounceMs,
  });
  // Per-session observability journal (JSONL): full execution trail on disk.
  const builderTraceStore = new SessionTraceStore({
    open: (sessionId) => new NodeAppendFile(path.join(BUILDER_TRACES_DIR, `${sessionId}.jsonl`)),
    flushDebounceMs: settings.fileFlushDebounceMs,
  });
  const sessionStore = new FileSessionStore({
    file: new AtomicJsonFile(SESSIONS_PATH),
    // Ledger blobs beside sessions.json: oversized entry texts stay retrievable
    // after restarts instead of dangling as memory-only locators.
    blobs: new FileBlobStore(`${SESSIONS_PATH}.blobs`),
    idGenerator,
    clock,
  });
  const sessions = new SessionService({ store: sessionStore, clock });
  // Builtin tool surface for the builder catalog: resolved once at the
  // composition root, so builder-service never imports tool implementations.
  const builtinTools = createBuiltinToolRegistry({
    maxOutputChars: settings.toolMaxOutputChars,
    maxFileChars: settings.toolMaxFileChars,
    runTimeoutDefaultS: settings.toolRunTimeoutDefaultS,
    runTimeoutMaxS: settings.toolRunTimeoutMaxS,
    webFetchTimeoutMs: settings.webFetchTimeoutMs,
    webSearchTimeoutMs: settings.webSearchTimeoutMs,
  });
  // Operator-tuned context strategy budgets: every column run carries them so
  // the harness strategies compare under identical, operator-chosen budgets.
  // Both objects are shared by reference with every column run: the runtime
  // knob store mutates them in place on settings saves (hot apply).
  const contextTuning: ContextTuning = {
    windowSize: settings.contextWindowMessages,
    charsPerToken: settings.contextCharsPerToken,
    summaryMaxChars: settings.contextSummaryMaxChars,
    tokenBudgetChars: settings.contextTokenBudgetChars,
    tokenBudgetKeepTurns: settings.contextTokenBudgetKeepTurns,
    toolTailBudgetChars: settings.contextToolTailBudgetChars,
    toolTailKeepChars: settings.contextToolTailKeepChars,
    budgetTokens: settings.contextBudgetTokens,
    compactTargetTokens: settings.contextCheckpointTargetTokens,
  };
  const harnessMaxRetries: { verify?: number; reflect?: number; selfEvolve?: number } = {};
  // Shared delegation/fetch tuning object: the knob store mutates it in place so
  // settings saves reach the next run without a restart.
  // Structural AgentToolTuning (agent package dep deliberately avoided here).
  const toolTuning: { subagentMaxSteps: number; ralphMaxRounds: number; mcpFetchTimeoutMs: number } = {
    subagentMaxSteps: settings.toolSubagentMaxSteps,
    ralphMaxRounds: settings.toolRalphMaxRounds,
    mcpFetchTimeoutMs: settings.mcpFetchTimeoutMs,
  };
  const runtimeKnobsStore = new RuntimeKnobsStore(
    new AtomicJsonFile(RUNTIME_KNOBS_PATH),
    defaultRuntimeKnobs(settings),
    (knobs) => applyRuntimeKnobs(knobs),
  );
  // Operator-tuned runtime knobs: file-backed overrides over the env defaults.
  // The store's onUpdate hot-applies the values (shared ContextTuning/harness
  // retry mutation + driver env writes) so settings saves need no restart.
  const llmCallOptions = (): { timeoutMs: number; maxRetries: number } => {
    const knobs = runtimeKnobsStore.current();
    return { timeoutMs: knobs.llmTimeoutMs, maxRetries: knobs.llmMaxRetries };
  };
  const applyRuntimeKnobs = (knobs: RuntimeKnobs): void => {
    contextTuning.windowSize = knobs.contextWindowMessages;
    contextTuning.charsPerToken = knobs.contextCharsPerToken;
    contextTuning.summaryMaxChars = knobs.contextSummaryMaxChars;
    contextTuning.tokenBudgetChars = knobs.contextTokenBudgetChars;
    contextTuning.tokenBudgetKeepTurns = knobs.contextTokenBudgetKeepTurns;
    contextTuning.toolTailBudgetChars = knobs.contextToolTailBudgetChars;
    contextTuning.toolTailKeepChars = knobs.contextToolTailKeepChars;
    contextTuning.budgetTokens = knobs.contextBudgetTokens;
    contextTuning.compactTargetTokens = knobs.contextCheckpointTargetTokens;
    harnessMaxRetries.verify = knobs.harnessRetries.verify;
    harnessMaxRetries.reflect = knobs.harnessRetries.reflect;
    harnessMaxRetries.selfEvolve = knobs.harnessRetries.selfEvolve;
    toolTuning.subagentMaxSteps = knobs.subagentMaxSteps;
    toolTuning.ralphMaxRounds = knobs.ralphMaxRounds;
    toolTuning.mcpFetchTimeoutMs = knobs.mcpFetchTimeoutMs;
    // Drivers read these env knobs per call, so writing them applies immediately.
    process.env["ARENA_SELF_CONSISTENCY_N"] = String(knobs.selfConsistencyN);
    process.env["ARENA_TOT_WIDTH"] = String(knobs.totWidth);
    process.env["ARENA_CREWAI_PROCESS"] = knobs.crewaiProcess;
  };
  applyRuntimeKnobs(runtimeKnobsStore.current());


  router.syncFrameworkOptions(available);
  router.syncCapabilityOptions(buildCapabilityOptionProjection());
  for (const dim of REQUIRED_CAPABILITY_DIMS) {
    if (dimensionCatalog.dimensionOptions(dim).length === 0) {
      throw new Error(`Required capability seam "${dim}" has zero implementations: refusing to start`);
    }
  }

  // Operator MCP servers attach to arena columns (best-effort per run).
  // The managed store file wins once it exists; otherwise the env parse seeds
  // it (backward compatible). `mcpServers` is the store's stable shared array,
  // mutated in place on settings saves, so every per-run consumer hot-reloads.
  let mcpEnvSeed: McpServerConfig[] = [];
  try {
    mcpEnvSeed = parseMcpServersEnv(process.env["MCP_SERVERS"], { defaultTimeoutMs: settings.mcpRequestTimeoutMs });
  } catch (error) {
    console.warn(`[assemble] MCP_SERVERS ignored: ${error instanceof Error ? error.message : String(error)}`);
  }
  const mcpServersStore = new McpServersStore({
    file: {
      exists: () => existsSync(MCP_SERVERS_PATH),
      read: () => readFileSync(MCP_SERVERS_PATH, "utf8"),
      // Atomic (tmp + .bak + rename): a crash mid-write must not leave a truncated
      // store that silently regresses the managed list to the env seed on next boot.
      write: (value: unknown) => {
        mkdirSync(DATA_DIR, { recursive: true });
        atomicWriteJson(MCP_SERVERS_PATH, value);
      },
    },
    seed: mcpEnvSeed,
  });
  const mcpServers = mcpServersStore.servers;

  // User skills: global data/skills directory + disabled-name list. The skill
  // tool discovers per call, so settings writes reach the next turn directly.
  configureUserSkills({
    fs: {
      readFile: (path) => readFileSync(path, "utf8"),
      writeFile: (path, content) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, "utf8");
      },
      deleteFile: (path) => {
        rmSync(path, { force: true });
        // Also drop the now-empty skill folder so listings stay clean.
        const dir = dirname(path);
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          // A non-empty dir means the operator keeps other files there; leave it.
        }
      },
      listDir: (dir) => {
        try {
          return readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
        } catch {
          return [];
        }
      },
      exists: (path) => existsSync(path),
    },
    dir: USER_SKILLS_DIR,
    settings: {
      read: () => {
        try {
          const raw = readJsonFile<unknown>(SKILL_SETTINGS_PATH);
          return Array.isArray(raw) ? (raw as string[]) : [];
        } catch {
          return [];
        }
      },
      write: (value) => {
        mkdirSync(DATA_DIR, { recursive: true });
        atomicWriteJson(SKILL_SETTINGS_PATH, value);
      },
    },
  });
  // Cross-session memory: one file-backed singleton shared by every arena run.
  // The memory dimension (episodic/semantic/full) recalls from and writes back to
  // these stores; a failed store degrades to stateless inside the agent layer.

  const episodicMemory = new EpisodicMemory({ filePath: MEMORY_EPISODIC_PATH });
  const semanticMemory = new SemanticMemory({ filePath: MEMORY_SEMANTIC_PATH });
  const memory = new MemoryServiceAdapter({ episodic: episodicMemory, semantic: semanticMemory });
  const builder = new BuilderService({
    store: builderStore,
    traceStore: builderTraceStore,
    sessions,
    driverLookup: registry,
    modelRuntime: builderModelRuntime,
    workspaceRegistry,
    idGenerator,
    clock,
    askUserWaitMs: settings.askUserWaitMs,
    contextTuning,
    toolTuning,
    harnessMaxRetries,
    memory,
    mcpServers,
    endpoints: builderEndpoints,
    toolDefinitions: () => builtinTools.listDefinitions(),
    resolveThinkingCapable: (endpointId: string) => {
      const provider = providerStore.load();
      const endpoint =
        endpointId === "" ? resolveDefaultEndpoint(provider) : lookupEndpoint(endpointId, provider, endpointCatalog);
      return endpoint?.thinking_capable ?? false;
    },
  });


  const runnerFactory = async (): Promise<ArenaRunner> =>
    new ArenaRunner({
      registry,
      router,
      workspaceRegistry,
      reportPublisher,
      modelFactory,
      idGenerator,
      clock,
      maxConcurrentRuns: settings.maxConcurrentRuns,
      breakerThreshold: settings.breakerThreshold,
      breakerCooldownMs: settings.breakerCooldownMs,
      askUserWaitMs: settings.askUserWaitMs,
      maxConcurrentColumns: settings.maxConcurrentColumns,
      mcpServers,
      sessionsQuery: sessions,
      contextTuning,
      toolTuning,
      maxDelegationDepth: runtimeKnobsStore.current().agentMaxDelegationDepth,
      eventRetention: settings.arenaEventRetention,
      disconnectGraceMs: settings.arenaDisconnectGraceMs,
      memory,
    });

  const arena = new ArenaService({ router, runnerFactory, answerJudge, sessions });
  const arenaLogs = new ArenaLogsService({ workspaceRegistry });
  const matrix = new MatrixService({ arena, now: () => clock.now() });
  // Durable agent threads (fork/resume): transcript + workspace survive restarts.
  const threads = new ThreadService({
    threads: new FileThreadStore({
      file: new AtomicJsonFile(THREADS_PATH),
      idGenerator,
      clock,
      caps: {
        maxThreads: settings.maxThreads,
        maxHistoryMessages: settings.threadMaxHistoryMessages,
        maxHistoryChars: settings.threadMaxHistoryChars,
      },
      flushDebounceMs: settings.fileFlushDebounceMs,
    }),
    arena,
    workspaceRegistry,
    clock,
    sessions,
    answerTailChars: settings.threadAnswerTailChars,
  });
  const providers = new ProviderService({ providerStore, providerCommand, idGenerator });
  const workspaces = new WorkspaceFileService({ workspaceRegistry });
  const projects = new ProjectStore({
    file: new AtomicJsonFile(PROJECTS_PATH),
    workspaceRegistry,
    clock,
    idGenerator,
    maxProjects: settings.projectMaxCount,
    maxSnapshotChars: settings.projectSnapshotMaxChars,
  });

  // Route assembly (bundle role): shell plus every domain route leaf.
  const app = mountDomainRoutes({
    settings,
    arena,
    arenaLogs,
    matrix,
    providers,
    workspaces,
    projects,
    builder,
    sessions,
    threads,
    clock,
    runtimeKnobs: {
      current: () => runtimeKnobsStore.current(),
      fields: () => RUNTIME_KNOB_FIELDS,
      update: (raw: unknown) => runtimeKnobsStore.update(raw),
    },
    memoryStatus: {
      status: () => ({
        episodicCount: episodicMemory.size,
        semanticCount: semanticMemory.size,
        episodicPath: MEMORY_EPISODIC_PATH,
        semanticPath: MEMORY_SEMANTIC_PATH,
      }),
      clear: () => {
        episodicMemory.clear();
        semanticMemory.clear();
      },
    },
    skills: {
      list: () => listSkillsForSettings(),
      create: (input) => ({ name: createUserSkill(input).name }),
      update: (name, patch) => ({ name: updateUserSkill(name, patch).name }),
      remove: (name) => deleteUserSkill(name),
      setEnabled: (name, enabled) => setSkillEnabled(name, enabled),
    },
    mcp: {
      list: () => mcpServersStore.list() as unknown as ReadonlyArray<Record<string, unknown>>,
      replace: (input: unknown) =>
        mcpServersStore.replace(input as McpServerConfig[]) as unknown as ReadonlyArray<Record<string, unknown>>,
    },
  });

  try {
    router.syncModelOptionsFromProvider();
  } catch (error) {
    console.warn(
      `[assemble] Initial model option sync failed (fell back to seed config; Arena works but model list may be incomplete): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    settings,
    app,
    // All three stores debounce writes: skipping one on shutdown silently drops its
    // post-debounce tail (builder sessions share the thread store's durability bar).
    flushDurableStores: async () => {
      await Promise.all([threads.flush(), builderStore.flushNow(), builderTraceStore.flushAll()]);
    },
  };
}
