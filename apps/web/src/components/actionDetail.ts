/**
 * @file actionDetail
 * @description One-line summary detail for a collapsed tool-call row, shared by the arena and builder traces.
 *
 * Responsibilities:
 * - Pick the row detail: the target path, else a whitelisted locating argument
 * - Keep command and content arguments off collapsed rows: they stay in the
 *   expandable args body
 *
 * Constraints:
 * - Pure function over the display segment; no React or i18n dependency
 * - A detail is a location hint, not a content preview: only known locating
 *   keys qualify, and a value longer than the one-line budget is dropped
 */

/** Longest argument still accepted as a one-line row detail. */
const DETAIL_MAX_CHARS = 64;

/**
 * Argument keys that carry a short locating hint (pattern, URL, query, action
 * verb, resource name). The list is a whitelist on purpose: shell tools store
 * their line under various keys (command, cmd, run-job's command, custom MCP
 * spellings), so an unknown key must never reach the collapsed row.
 */
const DETAIL_KEYS = new Set(["pattern", "url", "query", "action", "name"]);

/**
 * Collapsed-row detail for a tool call: target path, else a whitelisted short
 * locating argument.
 *
 * Command content never surfaces here: a shell line wraps the collapsed row and
 * reads as noise until the step is opened — it stays in the expandable args
 * body. Any argument outside the whitelist, or longer than the one-line budget,
 * is dropped rather than truncated.
 */
export function actionDetail(seg: { tool?: string; args?: Record<string, unknown> }): string {
  const args = seg.args ?? {};
  if (typeof args.path === "string" && args.path !== "") return args.path;
  const first = Object.entries(args)
    .filter(([key]) => DETAIL_KEYS.has(key))
    .map(([, value]) => value)
    .find((value) => typeof value === "string" && value !== "");
  if (typeof first !== "string") return "";
  const line = first.split("\n")[0] ?? first;
  return line.length <= DETAIL_MAX_CHARS ? line : "";
}
