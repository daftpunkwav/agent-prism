/**
 * @file repeat-reminder
 * @description Advisory repeat-call detector with escalating thresholds.
 *
 * Responsibilities:
 * - Track consecutive identical tool calls (name + canonical args)
 * - Emit advisory reminders at configured thresholds, once per crossing
 * - Never veto or rewrite calls (advisory only, like a linter note)
 *
 * A model stuck re-issuing the same call (polling a job, re-reading a file,
 * retrying a failing command verbatim) burns budget without progress. The
 * reminder names the loop and suggests the fix (vary args, check completion,
 * stop polling); the call still executes. Only successful executions count:
 * rejected calls (unknown/unauthorized/blocked) never ran, so they neither
 * count nor reset the streak.
 */

export interface RepeatReminderOptions {
  /** Consecutive-repeat counts that trigger a reminder (default [3, 5, 8]). */
  thresholds?: number[];
  /** Tool-name patterns to track (`*` wildcards; empty tracks everything). */
  include?: string[];
  /** Tool-name patterns transparent to tracking (neither count nor reset). */
  exclude?: string[];
  /** Max chars of canonical args quoted in detailed reminders (default 500). */
  argumentsPreviewChars?: number;
}

/** Default escalation thresholds. */
export const REPEAT_THRESHOLDS = [3, 5, 8];

/** Default args preview cap for detailed reminders. */
export const REPEAT_ARGS_PREVIEW = 500;

/** Matches `*`-wildcard patterns against tool names. */
export function matchToolPattern(pattern: string, toolName: string): boolean {
  if (pattern === "*" || pattern === "") return true;
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(toolName);
}

/** Canonical args key: sorted-keys JSON (full string for detection). */
export function canonicalArgsKey(args: Record<string, unknown>): string {
  const sorted = Object.keys(args).sort();
  const parts = sorted.map((key) => `${JSON.stringify(key)}:${JSON.stringify(args[key]) ?? "null"}`);
  return `{${parts.join(",")}}`;
}

/** Per-column repeat tracker (one instance per execution). */
export class RepeatTracker {
  private readonly thresholds: number[];
  private readonly include: string[];
  private readonly exclude: string[];
  private readonly previewChars: number;
  private lastKey: string | null = null;
  private streak = 0;
  private readonly fired = new Set<string>();

  constructor(options: RepeatReminderOptions = {}) {
    const thresholds = (options.thresholds ?? REPEAT_THRESHOLDS).filter(
      (value) => Number.isInteger(value) && value >= 2,
    );
    if (thresholds.length === 0) {
      throw new Error("repeat thresholds must hold at least one integer >= 2");
    }
    this.thresholds = [...new Set(thresholds)].sort((a, b) => a - b);
    this.include = [...(options.include ?? [])];
    this.exclude = [...(options.exclude ?? [])];
    const preview = options.argumentsPreviewChars ?? REPEAT_ARGS_PREVIEW;
    this.previewChars = Number.isFinite(preview) && preview > 0 ? Math.floor(preview) : REPEAT_ARGS_PREVIEW;
  }

  private tracked(toolName: string): boolean {
    if (this.exclude.some((pattern) => matchToolPattern(pattern, toolName))) return false;
    if (this.include.length === 0) return true;
    return this.include.some((pattern) => matchToolPattern(pattern, toolName));
  }

  /**
   * Records one successful execution; returns a reminder when a threshold is
   * crossed for the first time on this streak, else null. Untracked tools are
   * transparent (neither count nor reset); tracked-but-different calls reset.
   */
  record(toolName: string, args: Record<string, unknown>): string | null {
    if (!this.tracked(toolName)) return null;
    const key = `${toolName}\n${canonicalArgsKey(args)}`;
    if (key === this.lastKey) {
      this.streak += 1;
    } else {
      this.lastKey = key;
      this.streak = 1;
      this.fired.clear();
    }
    const threshold = this.thresholds.find((value) => value === this.streak);
    if (threshold === undefined) return null;
    // Dedupe per (call, threshold): each escalation level fires exactly once.
    const firing = `${threshold}\n${key}`;
    if (this.fired.has(firing)) return null;
    this.fired.add(firing);
    const preview = canonicalArgsKey(args).slice(0, this.previewChars);
    if (threshold === this.thresholds[0]) {
      return `[Repeat guard] \`${toolName}\` called ${threshold}x in a row with the same arguments (${preview}). If the result already answers the task, stop and report it; otherwise vary the arguments or try a different tool.`;
    }
    return `[Repeat guard] \`${toolName}\` called ${threshold}x in a row unchanged — this looks like a loop. State what new information the next identical call could possibly yield; if none, stop calling it.`;
  }
}
