/**
 * @file tool-access
 * @description Assembles one column's tool surface and its guarded execute path.
 *
 * Responsibilities:
 * - Filter the builtin registry by toolset policy or explicit tool-name allowlist
 * - Attach MCP tools per policy and overwrite placeholders with live delegation,
 *   session query, and ask_user tools when their hooks are injected
 * - Wrap every execute with approval review, catastrophic sandbox deny, RAG
 *   invalidation, and the repeat guard so drivers cannot bypass them
 *
 * Agent-layer module: consumed by agent-execution with value-only inputs and
 * spawn hooks as plain function types; no orchestration state lives here.
 */

import {
  sanitizeErrorMessage,
  type AskUserRespond,
  type SessionQueryPort,
  type ToolDefinition,
  type ToolExecuteOptions,
  type ToolWorkspace,
} from "@agentprism/contracts";
import { RepeatTracker, type RagStoreCache, type ToolAccess } from "@agentprism/harness";
import type { Workspace } from "@agentprism/runtime";
import { ApprovalGate, normalizeApprovalMode, normalizeSandboxMode, toBeforeExecute } from "@agentprism/sandbox";
import {
  createBuiltinToolRegistry,
  liveAskUserTool,
  normalizeSubagentMode,
  readInt,
  RALPH_DEFAULT_ROUNDS,
  RALPH_MAX_ROUNDS,
  RALPH_TOOL_NAME,
  ralphPlaceholderTool,
  safeFetchText,
  scatterPlaceholderTool,
  SCATTER_DEFAULT_STEPS,
  SCATTER_MAX_STEPS,
  SCATTER_MAX_TASKS,
  SCATTER_MIN_TASKS,
  SCATTER_TOOL_NAME,
  SESSION_QUERY_DEFAULT_LIMIT,
  SESSION_QUERY_MAX_LIMIT,
  SESSION_QUERY_TOOL_NAME,
  sessionQueryPlaceholderTool,
  subagentPlaceholderTool,
  SUBAGENT_DEFAULT_STEPS,
  SUBAGENT_MAX_STEPS,
  SUBAGENT_TOOL_NAME,
} from "@agentprism/tool-builtins";
import { mcpToolsForPolicy, MCP_FETCH_TIMEOUT_MS, registerMcpTools } from "@agentprism/tool-mcp";
import { selectToolNames } from "@agentprism/tool-registry";

/**
 * Runs one nested turn and resolves its final answer text (never throws: failures become text).
 * mode=spawn starts blank-history; mode=fork inherits the parent transcript so far.
 */
export type SubagentSpawn = (task: string, maxSteps: number, mode?: "spawn" | "fork") => Promise<string>;

/** Runs bounded fresh-child rounds toward one objective (never throws: failures become text). */
export type RalphSpawn = (objective: string, maxRounds: number) => Promise<string>;

/**
 * Operator-tunable delegation/fetch knobs for one column execution. Absent
 * fields keep the built-in defaults; values ride from settings via the run spec.
 */
export interface AgentToolTuning {
  /** Upper clamp for model-supplied subagent step budgets (default 10). */
  subagentMaxSteps?: number;
  /** Upper clamp for model-supplied ralph loop rounds (default 8). */
  ralphMaxRounds?: number;
  /** Per-fetch timeout in ms for the in-process MCP fetch server (default 15000). */
  mcpFetchTimeoutMs?: number;
}

/** Wraps a ralph hook as the live ralph_loop ToolDefinition (same name/schema as the placeholder). */
function liveRalphTool(spawn: RalphSpawn, tuning: AgentToolTuning): ToolDefinition {
  return {
    ...ralphPlaceholderTool,
    execute: async (_workspace, args) => {
      const objective = typeof args.objective === "string" ? args.objective.trim() : "";
      if (objective === "") {
        return { result: "Error: objective must be a non-empty goal description", fileDiff: null, ok: false, code: "workspace_error" };
      }
      const maxRounds = Math.min(tuning.ralphMaxRounds ?? RALPH_MAX_ROUNDS, Math.max(1, readInt(args, "max_rounds", RALPH_DEFAULT_ROUNDS)));
      return { result: await spawn(objective, maxRounds), fileDiff: null, ok: true };
    },
  };
}

/** Read cap helper: floors negatives, defaults, and caps per call. */
function readLimit(args: Record<string, unknown>, key: string): number {
  const raw = args[key];
  if (raw === undefined || raw === null || raw === "") return SESSION_QUERY_DEFAULT_LIMIT;
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num)) return SESSION_QUERY_DEFAULT_LIMIT;
  return Math.min(SESSION_QUERY_MAX_LIMIT, Math.max(1, Math.trunc(num)));
}

/** Wraps a session query port as the live session_query ToolDefinition. */
function liveSessionQueryTool(sessions: SessionQueryPort): ToolDefinition {
  return {
    ...sessionQueryPlaceholderTool,
    execute: async (_workspace, args) => {
      // Action names are case-tolerant so a cased call still binds instead of error-looping.
      const action = String(args.action ?? "").trim().toLowerCase();
      if (action === "list") {
        const limit = readLimit(args, "limit");
        let records;
        try {
          records = await sessions.listSessions({ limit });
        } catch (error) {
          return { result: `Error: session list failed: ${sanitizeErrorMessage(error)}`, fileDiff: null, ok: false, code: "workspace_error" };
        }
        if (records.length === 0) return { result: "(no sessions recorded)", fileDiff: null, ok: true };
        const lines = records.slice(0, limit).map(
          (record) => `- ${record.id} [${record.kind}/${record.status}] ${record.title}`,
        );
        return { result: lines.join("\n"), fileDiff: null, ok: true };
      }
      if (action === "read") {
        const id = typeof args.id === "string" ? args.id.trim() : "";
        if (id === "") {
          return { result: "Error: read needs an id from the list", fileDiff: null, ok: false, code: "workspace_error" };
        }
        const limit = readLimit(args, "limit");
        let detail;
        try {
          detail = await sessions.getSession(id);
        } catch (error) {
          return { result: `Error: session read failed: ${sanitizeErrorMessage(error)}`, fileDiff: null, ok: false, code: "workspace_error" };
        }
        if (detail === null) {
          return { result: `Error: unknown session ${JSON.stringify(id)}`, fileDiff: null, ok: false, code: "workspace_error" };
        }
        const entries = detail.entries.slice(-limit).map(
          (entry) => `#${entry.seq} [${entry.kind}] ${entry.content.slice(0, 300)}`,
        );
        const summary = detail.record.summary === null ? "" : `\nSummary: ${detail.record.summary}`;
        return {
          result: `# ${detail.record.title} [${detail.record.kind}/${detail.record.status}]${summary}\n${entries.join("\n") || "(no entries)"}`,
          fileDiff: null,
          ok: true,
        };
      }
      if (action === "read_entry") {
        const id = typeof args.id === "string" ? args.id.trim() : "";
        if (id === "") {
          return { result: "Error: read_entry needs an id from the list", fileDiff: null, ok: false, code: "workspace_error" };
        }
        const rawSeq = typeof args.seq === "number" ? args.seq : Number(args.seq);
        if (!Number.isInteger(rawSeq) || rawSeq < 0) {
          return { result: "Error: read_entry needs a seq from the read listing", fileDiff: null, ok: false, code: "workspace_error" };
        }
        if (sessions.readSessionBlob === undefined) {
          return { result: "Error: session blob reads are not supported by this runtime", fileDiff: null, ok: false, code: "workspace_error" };
        }
        let blob: string | null;
        try {
          blob = await sessions.readSessionBlob(id, rawSeq);
        } catch (error) {
          return { result: `Error: session blob read failed: ${sanitizeErrorMessage(error)}`, fileDiff: null, ok: false, code: "workspace_error" };
        }
        if (blob === null) {
          return { result: `Error: unknown session/blob ${JSON.stringify(id)}#${rawSeq} (memory-only stores lose blobs on restart)`, fileDiff: null, ok: false, code: "workspace_error" };
        }
        const lines = blob.split("\n");
        const offsetRaw = typeof args.offset === "number" ? args.offset : Number(args.offset);
        const limitRaw = typeof args.limit === "number" ? args.limit : Number(args.limit);
        const offset = Number.isInteger(offsetRaw) && offsetRaw > 0 ? offsetRaw : 1;
        const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(500, limitRaw) : 100;
        const page = lines.slice(offset - 1, offset - 1 + limit);
        const range = `lines ${offset}–${offset + page.length - 1} of ${lines.length}`;
        const tail = offset + page.length <= lines.length ? ` (offset/limit to page)` : "";
        return {
          result: `# blob ${id}#${rawSeq} [${range}]${tail}\n${page.join("\n")}`,
          fileDiff: null,
          ok: true,
        };
      }
      return { result: "Error: action must be one of list, read, read_entry", fileDiff: null, ok: false, code: "workspace_error" };
    },
  };
}

/** Scatter fan-out hook type (parallel children, joined answer; never throws for turn failures). */
export type ScatterSpawn = (
  tasks: string[],
  maxSteps: number,
  mode: "spawn" | "fork",
  strategy: "concat" | "vote",
) => Promise<string>;

/** Wraps a scatter hook as the live scatter ToolDefinition (same name/schema as the placeholder). */
function liveScatterTool(spawn: ScatterSpawn): ToolDefinition {
  return {
    ...scatterPlaceholderTool,
    execute: async (_workspace, args) => {
      const raw = args.tasks;
      if (!Array.isArray(raw)) {
        return { result: "Error: tasks must be an array of 2-8 subtask descriptions", fileDiff: null, ok: false, code: "workspace_error" };
      }
      const tasks = (raw as unknown[]).map((item) => (typeof item === "string" ? item.trim() : "")).filter((item) => item !== "");
      if (tasks.length < SCATTER_MIN_TASKS || tasks.length > SCATTER_MAX_TASKS) {
        return { result: `Error: tasks must hold ${SCATTER_MIN_TASKS}-${SCATTER_MAX_TASKS} non-empty subtasks (got ${tasks.length})`, fileDiff: null, ok: false, code: "workspace_error" };
      }
      const maxSteps = Math.min(SCATTER_MAX_STEPS, Math.max(1, readInt(args, "max_steps", SCATTER_DEFAULT_STEPS)));
      const mode = normalizeSubagentMode(args.mode);
      const strategy = String(args.strategy ?? "").trim().toLowerCase() === "vote" ? "vote" : "concat";
      return { result: await spawn(tasks, maxSteps, mode, strategy), fileDiff: null, ok: true };
    },
  };
}

/** Wraps a spawn hook as the live subagent ToolDefinition (same name/schema as the placeholder). */
function liveSubagentTool(spawn: SubagentSpawn, tuning: AgentToolTuning): ToolDefinition {
  return {
    ...subagentPlaceholderTool,
    execute: async (_workspace, args) => {
      const task = typeof args.task === "string" ? args.task.trim() : "";
      if (task === "") {
        return { result: "Error: task must be a non-empty subtask description", fileDiff: null, ok: false, code: "workspace_error" };
      }
      const maxSteps = Math.min(tuning.subagentMaxSteps ?? SUBAGENT_MAX_STEPS, Math.max(1, readInt(args, "max_steps", SUBAGENT_DEFAULT_STEPS)));
      const mode = normalizeSubagentMode(args.mode);
      const answer = await spawn(task, maxSteps, mode);
      return { result: mode === "fork" ? `[forked context] ${answer}` : answer, fileDiff: null, ok: true };
    },
  };
}

/**
 * Host fetch capability for the MCP fetch server: the SSRF-guarded bounded
 * read from tool-builtins, adapted to the seam's contract. HTTP failures throw
 * so the tool surfaces the status; policy rejections stay UrlValidationError.
 */
async function safeFetchUrl(url: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<string> {
  const { response, text } = await safeFetchText(url, {
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return text;
}

/** Shared catastrophic-deny guard: stateless, safe to reuse across executions. */
const sandboxGuard = toBeforeExecute();

/**
 * Builds column tool access: toolset-filtered registry plus live delegation tools.
 *
 * RAG invalidation, sandbox deny-list, and authorization wrap every call here so
 * drivers cannot bypass them; see the inline invariants on the execute path.
 */
export function buildToolAccess(
  workspace: Workspace,
  toolset: string,
  ragCache: RagStoreCache,
  signal?: AbortSignal,
  toolNames?: readonly string[],
  subagentSpawn?: SubagentSpawn,
  ralphSpawn?: RalphSpawn,
  scatterSpawn?: ScatterSpawn,
  mcpPolicy: string = "off",
  skillPolicy: string = "on_demand",
  sessions?: SessionQueryPort,
  approvalMode: string = "auto",
  sandboxMode: string = "off",
  askUser?: AskUserRespond,
  tuning: AgentToolTuning = {},
): ToolAccess {
  const approvalGate = new ApprovalGate(normalizeApprovalMode(approvalMode));
  const full = createBuiltinToolRegistry();
  // One repeat tracker per column execution (shared by direct and LC-bridged
  // calls through this access; nested runs build their own access).
  const repeats = new RepeatTracker();
  const names = new Set(
    toolNames !== undefined
      ? full.listDefinitions().map((d) => d.name).filter((name) => toolNames.includes(name))
      : selectToolNames(toolset),
  );
  // Skill policy off removes the skill tool so the model cannot load runbooks;
  // preloaded keeps the tool (workspace overrides may still matter) but the
  // prompt already carries the bundled bodies (see skillPreloadBlock below).
  if (toolNames === undefined && skillPolicy === "off") {
    names.delete("skill");
  }
  const registry = full.select([...names]);
  // MCP attachment: filesystem servers join every toolset; the fetch server only
  // joins full (mirrors webfetch/web_search staying out of edit_run/read_only).
  // Explicit toolNames overrides (builder sessions) stay authoritative: MCP joins
  // only the toolset-derived path so an operator allowlist is never broadened.
  if (toolNames === undefined) {
    const wanted = mcpToolsForPolicy(mcpPolicy).filter((name) => {
      if (name === "mcp__fetch_url") return toolset === "full";
      return true;
    });
    if (wanted.length > 0) {
      const fetchTimeoutMs = tuning.mcpFetchTimeoutMs ?? MCP_FETCH_TIMEOUT_MS;
      for (const name of registerMcpTools(registry, mcpPolicy, { fetchUrl: (url, signal) => safeFetchUrl(url, signal, fetchTimeoutMs) })) {
        if (wanted.includes(name)) names.add(name);
      }
    }
  }
  // The placeholder carries name+schema for discovery; only a live execution can
  // answer, so the live definition overwrites it exactly when selected. Depth is
  // enforced by withholding spawn (never by trusting the model to stop).
  if (subagentSpawn !== undefined && names.has(SUBAGENT_TOOL_NAME)) {
    registry.register(liveSubagentTool(subagentSpawn, tuning));
  }
  if (ralphSpawn !== undefined && names.has(RALPH_TOOL_NAME)) {
    registry.register(liveRalphTool(ralphSpawn, tuning));
  }
  if (scatterSpawn !== undefined && names.has(SCATTER_TOOL_NAME)) {
    registry.register(liveScatterTool(scatterSpawn));
  }
  // The placeholder carries name+schema for discovery; the live definition
  // overwrites it exactly when a query port is injected. Without a port the
  // tool stays listed but fail-closed (same pattern as delegation tools).
  if (sessions !== undefined && names.has(SESSION_QUERY_TOOL_NAME)) {
    registry.register(liveSessionQueryTool(sessions));
  }
  // The placeholder-free headless definition is overwritten exactly when a live human
  // channel is injected (same pattern as delegation tools): without the port, ask_user
  // records and defers so unattended runs never block.
  if (askUser !== undefined && names.has("ask_user")) {
    registry.register(liveAskUserTool(askUser));
  }
  // OS write containment: when enabled, tool handlers spawn shell children under
  // the restricted-token sandbox limited to the workspace root. Unenforceable
  // requests fail closed inside the spawn layer — never silently unsandboxed.
  const sandboxHint = normalizeSandboxMode(sandboxMode) === "os" ? { writableRoots: [workspace.root] } : undefined;
  // Prototype-faithful clone keeps Workspace's prototype (cwd, instanceof) and
  // own state; the sandbox hint is the only addition handlers see.
  const toolWorkspace: ToolWorkspace =
    sandboxHint === undefined
      ? workspace
      : Object.assign(Object.create(Object.getPrototypeOf(workspace)), workspace, { sandbox: sandboxHint });
  return {
    registry,
    names,
    async execute(name: string, args: Record<string, unknown>, options?: Omit<ToolExecuteOptions, "authorizedNames">) {
      return registry.execute(toolWorkspace, name, args, {
        ...options,
        authorizedNames: names,
        // Safety invariant (not policy): approval and catastrophic shell shapes
        // are denied even when a caller hook allows them; the caller hook may
        // only add denials. Approval (mode-configured) runs ahead of the
        // catastrophic sandbox guard.
        beforeExecute: (hookName, hookArgs) =>
          options?.beforeExecute?.(hookName, hookArgs) ??
          approvalGate.review(hookName, hookArgs) ??
          sandboxGuard(hookName, hookArgs),
        signal: options?.signal ?? signal,
        afterExecute(toolName, toolArgs, outcome) {
          const definition = registry.listDefinitions().find((item) => item.name === toolName);
          if (definition?.mutatesWorkspace) {
            ragCache.invalidate(workspace);
          }
          // Repeat guard (advisory, all drivers): only successful executions
          // count — rejected calls never ran. The reminder appends to the same
          // result object the driver transcribes, so every backend sees it.
          if (outcome.ok) {
            const reminder = repeats.record(toolName, toolArgs);
            if (reminder !== null) outcome.result += `\n\n${reminder}`;
          }
          options?.afterExecute?.(toolName, toolArgs, outcome);
        },
      });
    },
  };
}
