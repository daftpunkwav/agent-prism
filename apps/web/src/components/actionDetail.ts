/**
 * @file actionDetail
 * @description One-line summary detail for a collapsed tool-call row, shared by the arena and builder traces.
 *
 * Responsibilities:
 * - Pick the row detail: the target path, else a short non-command argument
 * - Keep command content off collapsed rows: it stays in the expandable args body
 *
 * Constraints:
 - Pure function over the display segment; no React or i18n dependency
 - A detail is a location hint, not a content preview: arguments longer than
   the one-line budget are dropped rather than truncated
 */

/** Longest argument still accepted as a one-line row detail. */
const DETAIL_MAX_CHARS = 64;

/**
 * Collapsed-row detail for a tool call: target path, else a short non-command argument.
 *
 * Command content never surfaces here: a shell line wraps the collapsed row and
 * reads as noise until the step is opened. Third-party MCP shells may carry the
 * line under other spellings (e.g. the legacy `cmd` key), so the known command
 * keys are excluded from the fallback pick and any remaining argument longer
 * than the one-line budget is dropped instead of truncated.
 */
export function actionDetail(seg: { tool?: string; args?: Record<string, unknown> }): string {
  const args = seg.args ?? {};
  if (typeof args.path === "string" && args.path !== "") return args.path;
  const first = Object.entries(args)
    .filter(([key]) => key !== "command" && key !== "cmd")
    .map(([, value]) => value)
    .find((value) => typeof value === "string" && value !== "");
  if (typeof first !== "string") return "";
  const line = first.split("\n")[0] ?? first;
  return line.length <= DETAIL_MAX_CHARS ? line : "";
}
