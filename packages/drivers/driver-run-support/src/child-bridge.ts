/**
 * @file child-bridge
 * @description NDJSON child-process bridge engine: spawn, line framing, request
 *              correlation, and cancellation for the framework bootstrap bridge.
 *
 * Responsibilities:
 * - Spawn the bootstrap process and frame its stdout into protocol messages
 * - Answer the child's llm/tool requests through the injected host handlers
 * - Surface framework events through the onEvent callback
 * - Kill the child on abort and report the abort reason as the failure
 *
 * The engine is transport-only: no framework knowledge and no event semantics.
 * Callers provide the handshake, the llm/tool handlers, and the event callback;
 * the promise settles when the child closes after writing `final` or `error`.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type {
  BridgeStart,
  ChildToHost,
  HostToChild,
} from "./bridge-protocol.js";

/** Host-side handler signatures the child can invoke over the bridge. */
export interface ChildBridgeHandlers {
  /** Round-trips one framework LLM completion to the arena model. */
  llmComplete(request: Extract<ChildToHost, { type: "llm_request" }>): Promise<string>;
  /** Executes one arena tool call; a thrown error becomes an ok:false tool_result. */
  toolExecute(request: Extract<ChildToHost, { type: "tool_request" }>): Promise<string>;
}

export interface ChildBridgeOptions {
  command: string;
  args: string[];
  cwd: string;
  start: BridgeStart;
  handlers: ChildBridgeHandlers;
  signal?: AbortSignal;
  /** Called for every `event` message, in arrival order. */
  onEvent?: (event: Extract<ChildToHost, { type: "event" }>) => void;
}

export type ChildBridgeOutcome =
  | { ok: true; answer: string }
  | { ok: false; message: string };

/**
 * Runs one bootstrap session to completion. Resolves with the final answer on
 * success, or a failure object when the child errored, exited without a final,
 * or the signal aborted (message carries the abort reason).
 */
export function runChildBridge(options: ChildBridgeOptions): Promise<ChildBridgeOutcome> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(options.command, options.args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      // The bootstrap is a plain interpreter invocation; a shell adds quoting
      // risk and nothing else.
      shell: false,
    });

    let buffer = "";
    let finalAnswer: string | null = null;
    let errorMessage: string | null = null;
    let settled = false;

    const writeLine = (payload: HostToChild): void => {
      if (child.stdin?.writable) child.stdin.write(`${JSON.stringify(payload)}\n`);
    };

    const finish = (outcome: ChildBridgeOutcome): void => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    const handleMessage = async (message: ChildToHost): Promise<void> => {
      switch (message.type) {
        case "llm_request": {
          let content = "";
          try {
            content = await options.handlers.llmComplete(message);
          } catch {
            // Handler failure degrades to an empty completion; the framework
            // turn surfaces the empty content and the run ends via error/final.
            content = "";
          }
          writeLine({ type: "llm_response", id: message.id, content });
          return;
        }
        case "tool_request": {
          let ok = true;
          let result = "";
          try {
            result = await options.handlers.toolExecute(message);
          } catch (error) {
            ok = false;
            result = error instanceof Error ? error.message : String(error);
          }
          writeLine({ type: "tool_result", id: message.id, ok, result });
          return;
        }
        case "event":
          options.onEvent?.(message);
          return;
        case "final":
          finalAnswer = message.answer;
          return;
        case "error":
          errorMessage = message.message;
          return;
        default:
          return;
      }
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
        if (line === "") continue;
        let message: ChildToHost;
        try {
          message = JSON.parse(line) as ChildToHost;
        } catch {
          continue; // framework print noise on stdout is dropped, never parsed
        }
        void handleMessage(message);
      }
    });

    let stderrTail = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-2000);
    });

    child.on("close", () => {
      if (finalAnswer !== null) {
        finish({ ok: true, answer: finalAnswer });
        return;
      }
      finish({
        ok: false,
        message: errorMessage ?? `bootstrap exited without a final answer${stderrTail !== "" ? `: ${stderrTail}` : ""}`,
      });
    });

    options.signal?.addEventListener(
      "abort",
      () => {
        errorMessage = options.signal?.reason instanceof Error ? options.signal.reason.message : "aborted";
        child.kill();
        // Force-kill fallback; on Windows kill() is already terminal so this is a no-op there.
        const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
        timer.unref?.();
      },
      { once: true },
    );

    writeLine(options.start);
  });
}
