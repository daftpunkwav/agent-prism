/**
 * @file tool-registry
 * @description Port for registering and executing workspace tools.
 *
 * Responsibilities:
 * - Define tool definitions, execution options, and result shapes
 *
 * Drivers must call execute(); bypassing the registry (vendor tool.invoke)
 * breaks side-effect hooks such as RAG invalidation.
 */

/** Outcome of one tool invocation. */
export interface ToolExecutionResult {
  result: string;
  fileDiff: string | null;
  /** False when the name is unknown or not authorized for the active toolset. */
  ok: boolean;
  /** Machine-readable failure code when ok is false. */
  code?: "unknown_tool" | "unauthorized_tool" | "workspace_error" | "aborted" | "timeout";
}

/** Arguments passed to a tool handler. */
export type ToolArgs = Record<string, unknown>;

/** Write-containment hint attached to a workspace: spawned shell children may write only inside these roots. */
export interface ToolSandboxHint {
  readonly writableRoots: readonly string[];
}

/**
 * Minimal workspace view required by tool handlers. Satisfied structurally by
 * the runtime Workspace; kept here so contracts stay free of runtime imports.
 */
export interface ToolWorkspace {
  name: string;
  root: string;
  cwd(): string;
  /** Opaque scoped filesystem; handlers cast to the environment type they need. */
  fs: unknown;
  /** When set, shell children spawn under the OS write-restricted sandbox (fail-closed where unenforceable). */
  readonly sandbox?: ToolSandboxHint;
}

/** Default human-channel wait before ask_user degrades to headless defer. */
export const DEFAULT_ASK_USER_WAIT_MS = 5 * 60_000;

/** One question the agent asks the attached human (ask_user wire shape). */
export interface AskUserQuestion {
  id: string;
  header: string;
  question: string;
  options: string[];
}

/** The attached human's reply to one ask_user batch; answered=false falls back to headless defer. */
export interface AskUserReply {
  answered: boolean;
  answers: ReadonlyArray<{ id: string; answer: string }>;
}

/**
 * Unwraps nested ask_user options arrays (shared by the tool parser, the
 * LangChain zod preprocessor, and action-event normalization).
 *
 * Models occasionally double-wrap (`options: [["A","B"]]` — the observed
 * "expected string, received array at questions[0].options[0]" failure).
 * Only array nesting is flattened; element validation (non-empty strings,
 * count/char caps) stays exactly as before in the tool parser and zod, so all
 * other malformed inputs keep their corrective errors.
 */
export function normalizeAskUserOptions(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const flat: unknown[] = [];
  const push = (item: unknown): void => {
    if (Array.isArray(item)) {
      for (const inner of item) push(inner);
      return;
    }
    flat.push(item);
  };
  for (const item of value) push(item);
  return flat;
}

/** Lowercases an ask_user batch's top-level and per-question keys (QUESTIONS/ID/... tolerance). */
export function lowerAskUserKeys(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) out[key.toLowerCase()] = entry;
  return out;
}

/**
 * Unwraps a stringified ask_user batch (shared by the tool parser, the LangChain
 * zod preprocessor, action-event normalization, and the modal parser).
 *
 * Some model/provider combos call the tool as `{"input": "<JSON string>"}` instead
 * of a structured object (observed live: the inner JSON was a perfectly valid
 * lowercase batch). Only unwraps when top-level `questions` is absent; a
 * single-question object `{question, ...}` is wrapped into a one-item batch.
 * Anything unparseable passes through untouched so callers still fail closed
 * with their corrective errors.
 */
export function unwrapAskUserInput(args: Record<string, unknown>): Record<string, unknown> {
  let current: Record<string, unknown> = args;
  for (let depth = 0; depth < 3; depth += 1) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) break;
    if (current.questions !== undefined) return current;
    if (typeof current.question === "string") return { questions: [current] };
    const inner: unknown = current.input;
    if (typeof inner === "string") {
      try {
        const parsed: unknown = JSON.parse(inner);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return current;
        current = parsed as Record<string, unknown>;
        continue;
      } catch {
        return current;
      }
    }
    if (inner !== null && typeof inner === "object" && !Array.isArray(inner)) {
      current = inner as Record<string, unknown>;
      continue;
    }
    return current;
  }
  return current;
}

/**
 * Full batch normalization: lowercase top-level keys, unwrap, then lowercase
 * again at both levels (an inner stringified payload may itself be cased).
 * Per-item key casing is normalized here so every consumer (parser, LangChain
 * preprocessor, action events, modal) shares one shape.
 */
export function normalizeAskUserBatchArgs(args: Record<string, unknown>): Record<string, unknown> {
  const batch = lowerAskUserKeys(unwrapAskUserInput(lowerAskUserKeys(args ?? {})));
  if (Array.isArray(batch.questions)) {
    batch.questions = (batch.questions as unknown[]).map((item) =>
      item !== null && typeof item === "object" && !Array.isArray(item)
        ? lowerAskUserKeys(item as Record<string, unknown>)
        : item,
    );
  }
  return batch;
}

/**
 * Port: hands one ask_user batch to an attached human and resolves with the reply.
 * Implementations own the wait (UI round-trip), timeout, and abort semantics; a
 * timeout resolves with answered=false so the tool degrades to the headless defer.
 */
export type AskUserRespond = (
  questions: readonly AskUserQuestion[],
  signal?: AbortSignal,
) => Promise<AskUserReply>;

/** One registered tool: schema for the model plus the side-effecting handler. */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema object describing the tool arguments (OpenAI/Anthropic-compatible). */
  readonly jsonSchema: Record<string, unknown>;
  readonly mutatesWorkspace: boolean;
  /**
   * Cooperative timeout budget in milliseconds. The registry arms this deadline
   * and aborts the derived signal; handlers must honor the signal and settle.
   * Omit for no deadline.
   */
  readonly timeoutMs?: number;
  execute(workspace: ToolWorkspace, args: ToolArgs, signal?: AbortSignal): Promise<ToolExecutionResult>;
}

/** Filter / hook context for registry.execute. */
export interface ToolExecuteOptions {
  signal?: AbortSignal;
  /** When set, names outside this set fail as unauthorized (fail-closed). */
  authorizedNames?: ReadonlySet<string>;
  beforeExecute?: (name: string, args: ToolArgs) => string | null;
  afterExecute?: (name: string, args: ToolArgs, outcome: ToolExecutionResult) => void;
}

/** Tool registry port: register once at composition, select per column toolset. */
export interface ToolRegistry {
  register(definition: ToolDefinition): void;
  /** Returns a new registry view limited to the given tool names (sorted). */
  select(names: readonly string[]): ToolRegistry;
  authorizedNames(): ReadonlySet<string>;
  listDefinitions(): readonly ToolDefinition[];
  execute(
    workspace: ToolWorkspace,
    name: string,
    args: ToolArgs,
    options?: ToolExecuteOptions,
  ): Promise<ToolExecutionResult>;
}
