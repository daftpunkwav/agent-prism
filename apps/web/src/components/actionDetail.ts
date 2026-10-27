/**
 * @file actionDetail
 * @description One-line summary detail for a collapsed tool-call row, shared by the arena and builder traces.
 *
 * Responsibilities:
 * - Pick the row detail: the target path, else the highest-priority whitelisted
 *   locating argument that fits the one-line budget
 * - Keep command and content arguments off collapsed rows: they stay in the
 *   expandable args body
 *
 * Constraints:
 * - Pure function over the display segment; no React or i18n dependency
 * - A detail is a location hint, not a content preview: only known locating
 *   keys qualify, and a value longer than the one-line budget is skipped
 */

/** Longest argument still accepted as a one-line row detail. */
const DETAIL_MAX_CHARS = 64;

/**
 * Argument keys that carry a short locating hint, in priority order. Target
 * hints (pattern, query, URL, name, directory) come before the bare action
 * verb: a symbols call with both `action: "search"` and `query: "parser"`
 * should show the target, not the verb. The list is a whitelist on purpose:
 * shell tools store their line under various keys (command, cmd, run-job's
 * command, custom MCP spellings), so an unknown key must never reach the
 * collapsed row.
 */
const DETAIL_KEYS = ["pattern", "query", "url", "name", "dir", "action"] as const;

/**
 * Collapsed-row detail for a tool call: target path, else the first whitelisted
 * locating argument that fits the one-line budget.
 *
 * Command content never surfaces here: a shell line wraps the collapsed row and
 * reads as noise until the step is opened — it stays in the expandable args
 * body. Values are tried in key-priority order so an oversized entry cannot
 * shadow a shorter usable hint on a later whitelisted key.
 */
export function actionDetail(seg: { tool?: string; args?: Record<string, unknown> }): string {
  const args = seg.args ?? {};
  if (typeof args.path === "string" && args.path !== "") return args.path;
  for (const key of DETAIL_KEYS) {
    const value = args[key];
    if (typeof value !== "string" || value === "") continue;
    const line = value.split("\n")[0] ?? value;
    if (line.length <= DETAIL_MAX_CHARS) return line;
  }
  return "";
}
