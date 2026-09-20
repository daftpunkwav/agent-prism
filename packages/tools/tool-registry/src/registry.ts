/**
 * @file registry
 * @description In-memory ToolRegistry with a single guarded execution entry.
 *
 * Responsibilities:
 * - Register tool definitions and select by name set
 * - Execute through hooks with fail-closed semantics
 */

import type {
  ToolArgs,
  ToolDefinition,
  ToolExecuteOptions,
  ToolExecutionResult,
  ToolRegistry,
  ToolWorkspace,
} from "@agentprism/contracts";

/** Mutable in-memory tool registry implementing the contracts ToolRegistry port. */
export class MapToolRegistry implements ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();

  register(definition: ToolDefinition): void {
    if (definition.name.trim() === "") {
      throw new TypeError("ToolDefinition.name must be non-empty");
    }
    if (
      definition.timeoutMs !== undefined &&
      (!Number.isFinite(definition.timeoutMs) || definition.timeoutMs <= 0)
    ) {
      throw new TypeError(`tool "${definition.name}" timeoutMs must be a positive finite number`);
    }
    this.definitions.set(definition.name, definition);
  }

  select(names: readonly string[]): ToolRegistry {
    const subset = new MapToolRegistry();
    for (const name of names) {
      const definition = this.definitions.get(name);
      if (definition !== undefined) {
        subset.register(definition);
      }
    }
    return subset;
  }

  authorizedNames(): ReadonlySet<string> {
    return new Set(this.definitions.keys());
  }

  listDefinitions(): readonly ToolDefinition[] {
    return [...this.definitions.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async execute(
    workspace: ToolWorkspace,
    name: string,
    args: ToolArgs,
    options: ToolExecuteOptions = {},
  ): Promise<ToolExecutionResult> {
    if (options.signal?.aborted) {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      throw abortError;
    }

    // Tool-name tolerance: models occasionally send ASK_USER / Ask_User. Registry keys
    // are lowercase builtins, so resolve case-insensitively before failing closed.
    const canonical =
      this.definitions.get(name) !== undefined
        ? name
        : [...this.definitions.keys()].find((key) => key.toLowerCase() === name.toLowerCase()) ?? name;
    const definition = this.definitions.get(canonical);
    if (definition === undefined) {
      const outcome: ToolExecutionResult = {
        result: `Error: unknown tool ${name}`,
        fileDiff: null,
        ok: false,
        code: "unknown_tool",
      };
      options.afterExecute?.(name, args, outcome);
      return outcome;
    }

    const authorized = options.authorizedNames ?? this.authorizedNames();
    const authorizedHit =
      authorized.has(canonical) ||
      [...authorized].some((entry) => entry.toLowerCase() === canonical.toLowerCase());
    if (!authorizedHit) {
      const outcome: ToolExecutionResult = {
        result: `Error: tool ${name} not authorized`,
        fileDiff: null,
        ok: false,
        code: "unauthorized_tool",
      };
      options.afterExecute?.(name, args, outcome);
      return outcome;
    }

    const blocked = options.beforeExecute?.(canonical, args) ?? null;
    if (blocked !== null) {
      const outcome: ToolExecutionResult = {
        result: blocked,
        fileDiff: null,
        ok: false,
        code: "unauthorized_tool",
      };
      options.afterExecute?.(canonical, args, outcome);
      return outcome;
    }

    // Cooperative deadline (deepseek-harness timeout-policy parity): when the tool
    // declares timeoutMs, arm a derived signal, await quiescence (never abandon
    // the tool promise), then replace the outcome with a structured timeout only
    // when our own timer fired. Caller cancellation still rethrows AbortError.
    if (definition.timeoutMs === undefined) {
      // No catch: AbortError and handler failures propagate unchanged to the driver,
      // which converges them (abort rethrows, other errors become error text).
      const outcome = await definition.execute(workspace, args, options.signal);
      options.afterExecute?.(canonical, args, outcome);
      return outcome;
    }
    const timeoutMs = definition.timeoutMs;
    const callerSignal = options.signal;
    const derived = new AbortController();
    const forwardAbort = (): void => {
      derived.abort(callerSignal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (callerSignal?.aborted) {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      throw abortError;
    }
    callerSignal?.addEventListener("abort", forwardAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      derived.abort(new DOMException(`tool call timed out after ${timeoutMs}ms`, "AbortError"));
    }, timeoutMs);
    // Avoid pinning the event loop for long budgets when the tool settles fast.
    (timer as unknown as { unref?: () => void }).unref?.();
    try {
      const outcome = await definition.execute(workspace, args, derived.signal);
      if (timedOut && !(callerSignal?.aborted === true)) {
        const timeoutOutcome: ToolExecutionResult = {
          result: `Error: tool call timed out after ${timeoutMs}ms`,
          fileDiff: null,
          ok: false,
          code: "timeout",
        };
        options.afterExecute?.(canonical, args, timeoutOutcome);
        return timeoutOutcome;
      }
      options.afterExecute?.(canonical, args, outcome);
      return outcome;
    } catch (error) {
      if ((error as Error)?.name === "AbortError" && timedOut && !(callerSignal?.aborted === true)) {
        const timeoutOutcome: ToolExecutionResult = {
          result: `Error: tool call timed out after ${timeoutMs}ms`,
          fileDiff: null,
          ok: false,
          code: "timeout",
        };
        options.afterExecute?.(name, args, timeoutOutcome);
        return timeoutOutcome;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", forwardAbort);
    }
  }
}
