/**
 * @file tool-replay
 * @description Custom dimension: which tool results replay into the model context.
 *
 * Responsibilities:
 * - Declare the tool-replay dimension and its three values
 * - Replace unwanted results with markers instead of deleting them (the hook)
 *
 * Previously shipped as a set of context strategies pinned to the `context`
 * dimension; it is a comparison axis of its own, so it now contributes one
 * dimension instead of extra rows on an existing one.
 *
 * Pairing rule: every tool call keeps a tool message, so the assistant/tool
 * pairing providers require stays valid on every wire format. Results are
 * replaced by a short marker; the shared pair-safety pass would drop an orphaned
 * call if a hook deleted results outright, which loses more than it needs to.
 * An omitted result is replaced rather than removed. The dimension also tags the
 * system prompt so a column states which replay granularity it ran under.
 */

import type { CustomDimension, CustomMessagesInput, LlmMessage } from "@agentprism/contracts";

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

/** Replaces the results of tools the predicate rejects with an omission marker. */
export function omitResults(messages: readonly LlmMessage[], keep: (tool: string) => boolean): LlmMessage[] {
  let lastCallNames: string[] = [];
  return messages.map((message) => {
    if (message.role === "assistant") {
      lastCallNames = toolNamesFromCall(message.toolCalls);
      return message;
    }
    if (message.role === "tool") {
      // Attribute by the tool message's own name when present; a parallel batch
      // mixes keep/drop calls, so batch-wide `.some` would keep results the
      // value must omit. Nameless messages fall back to the preceding batch.
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
}

/** The tool-replay dimension: full replay, read results omitted, or writes only. */
export const toolReplayDimension: CustomDimension = {
  id: "tool_replay",
  label: "Tool-result replay",
  subtitle: "Which past tool results replay into the model context",
  options: [
    { value: "all", label: "All results", description: "Replay every tool call with its full result (most faithful)." },
    { value: "skip_read", label: "Skip read results", description: "Replace read-only results (read/glob/grep/ls) with a marker." },
    { value: "writes_only", label: "Writes only", description: "Keep only write-class results; everything else becomes a marker." },
  ],
  default: "all",
  promptHint: "\n[Context: tool-result replay = {value}]",
  hooks: {
    messages: (input: CustomMessagesInput, value) => {
      if (value === "skip_read") return omitResults(input.messages, (tool) => !READ_TOOLS.has(tool));
      if (value === "writes_only") return omitResults(input.messages, (tool) => WRITE_TOOLS.has(tool));
      return input.messages;
    },
  },
};
