/**
 * @file context-assembly
 * @description Example custom context strategies: tool-call replay granularity.
 *
 * Responsibilities:
 * - Export three ContextStrategyPlugin strategies that differ only in which
 *   tool call results replay into the model context
 * - Serve as the reference implementation for adding a new custom dimension
 *   subpackage (see docs/reference/add-a-custom-dimension.md)
 *
 * All three strategies keep every tool message (so tool_call/tool_result
 * pairing stays valid on every provider); an omitted result is replaced by a
 * short marker instead of being removed.
 */

import type { ContextStrategyPlugin } from "@agentprism/contracts";
import type { LlmMessage } from "@agentprism/contracts";

/** Read-only inspection tools: results are large and rarely need full replay. */
const READ_TOOLS = new Set(["read", "glob", "grep", "ls"]);
/** Mutating tools: their calls and results are the transcript's core evidence. */
const WRITE_TOOLS = new Set(["write", "edit", "apply_patch", "bash", "bash_session", "run_job"]);

const READ_RESULT_MARKER = "[omitted: read-only tool result]";
const NON_WRITE_RESULT_MARKER = "[omitted: non-mutating tool result]";

function toolNamesFromCall(calls: unknown): string[] {
  if (typeof calls !== "object" || calls === null || !Array.isArray(calls)) return [];
  return calls
    .map((call) => (call as { name?: unknown }).name)
    .filter((name): name is string => typeof name === "string");
}

function makeOmissionPlugin(id: string, label: string, description: string, keep: (tool: string) => boolean) {
  return {
    id,
    label,
    description,
    apply: (messages: LlmMessage[]): LlmMessage[] => {
      let lastCallNames: string[] = [];
      return messages.map((message) => {
        if (message.role === "assistant") {
          lastCallNames = toolNamesFromCall(message.toolCalls);
          return message;
        }
        if (message.role === "tool") {
          // Attribute by the tool message's own name when present; a parallel
          // batch mixes keep/drop calls, so batch-wide `.some` would keep
          // results the strategy must omit. Nameless messages fall back to the
          // preceding assistant batch.
          const own = typeof message.name === "string" ? message.name : undefined;
          const names = own !== undefined ? [own] : lastCallNames;
          if (!names.some((name) => keep(name))) {
            return {
              ...message,
              content:
                names.length > 0 && names.every((name) => READ_TOOLS.has(name))
                  ? READ_RESULT_MARKER
                  : NON_WRITE_RESULT_MARKER,
            };
          }
        }
        return message;
      });
    },
  };
}

/** All tool calls replay with names and results (the most faithful replay). */
const assemblyAll: ContextStrategyPlugin = {
  id: "assembly_all",
  label: "Assembly: all tool calls",
  description: "Replays every tool call with its full result.",
  apply: (messages) => messages,
};

/** Everything except read-only results replays (read/glob/grep/ls become markers). */
const assemblyOps: ContextStrategyPlugin = makeOmissionPlugin(
  "assembly_ops",
  "Assembly: skip read results",
  "Replays all tool calls but replaces read-only results (read/glob/grep/ls) with an omission marker.",
  (tool) => !READ_TOOLS.has(tool),
);

/** Only mutating tool results replay; everything else becomes a marker. */
const assemblyWrites: ContextStrategyPlugin = makeOmissionPlugin(
  "assembly_writes",
  "Assembly: mutating results only",
  "Replays only write-class tool results (write/edit/apply_patch/bash/...); all other results become markers.",
  (tool) => WRITE_TOOLS.has(tool),
);

/** The pluggable strategies this subpackage contributes to the context dimension. */
export const contextAssemblyPlugins: ContextStrategyPlugin[] = [assemblyAll, assemblyOps, assemblyWrites];
