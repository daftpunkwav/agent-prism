/**
 * @file context-compaction/surface
 * @description Turn-frame message surface with token metering and span selection.
 *
 * Responsibilities:
 * - Hold an ordered frame surface (one frame per turn segment)
 * - Meter frames with a char-proxy token estimate
 * - Select compaction spans with pair safety: least important first, then oldest
 *
 * Frames generalize chat turns and tool rounds: each frame carries a role,
 * text, an importance weight, and a compactable flag. Pinned frames (system
 * prompts, fresh turns) never enter a span. Assistant/tool pairs compact
 * together or not at all, so providers never see orphaned tool results.
 */

export type FrameRole = "system" | "user" | "assistant" | "tool";

/** One compactable unit of the surface. */
export interface SurfaceFrame {
  id: string;
  role: FrameRole;
  text: string;
  /** Importance weight (higher survives longer under equal age). */
  weight: number;
  /** False pins the frame against every selection. */
  compactable: boolean;
  /** Tool name for tool frames (pairing key with assistant toolCalls). */
  tool?: string;
}

/** Default characters per estimated token (conservative English/CJK blend). */
export const CHARS_PER_TOKEN = 4;

/**
 * Token estimate for text via the char proxy. Hosts with a different text layout
 * (CJK-heavy labs set a smaller divisor) inject theirs, so metering here agrees
 * with the budget arithmetic that decided what to compact.
 */
export function estimateTokens(text: string, charsPerToken: number = CHARS_PER_TOKEN): number {
  return Math.max(1, Math.ceil(text.length / charsPerToken));
}

/** Token estimate for a frame (text plus a small role overhead). */
export function frameTokens(frame: SurfaceFrame, charsPerToken: number = CHARS_PER_TOKEN): number {
  return estimateTokens(frame.text, charsPerToken) + 4;
}

/** Total estimated tokens across frames. */
export function surfaceTokens(frames: readonly SurfaceFrame[], charsPerToken: number = CHARS_PER_TOKEN): number {
  return frames.reduce((sum, frame) => sum + frameTokens(frame, charsPerToken), 0);
}

/** Frame weight, normalized: a missing or nonsensical weight counts as neutral (0). */
function frameWeight(frame: SurfaceFrame): number {
  return Number.isFinite(frame.weight) && frame.weight > 0 ? frame.weight : 0;
}

export interface CompactionSpan {
  /** Inclusive start index into the surface array. */
  start: number;
  /** Inclusive end index. */
  end: number;
  /** Estimated tokens covered by the span. */
  tokens: number;
  /** Frame ids covered (for journal references). */
  ids: string[];
}

export interface SpanOptions {
  /** Characters per token for metering (defaults to CHARS_PER_TOKEN). */
  charsPerToken?: number;
}

/**
 * Selects the compactable span to condense, preferring the least important
 * material and only then the oldest: `weight` is the soft protection the frame
 * contract promises (higher weight survives longer), and equally weighted spans
 * fall back to the oldest start so recent turns are the last to go. Ties on both
 * keys take the smallest span, which condenses no more than the overflow needs.
 *
 * Pair safety: a span never starts on a tool frame whose assistant turn sits
 * outside the span, and never ends between an assistant call and its tool
 * result. Pinned frames terminate spans. Returns null when nothing qualifies.
 */
export function selectSpan(
  frames: readonly SurfaceFrame[],
  targetTokens: number,
  options: SpanOptions = {},
): CompactionSpan | null {
  if (targetTokens <= 0) return null;
  const charsPerToken = options.charsPerToken ?? CHARS_PER_TOKEN;
  let best: CompactionSpan | null = null;
  let bestWeight = 0;
  for (let start = 0; start < frames.length; start += 1) {
    const first = frames[start] as SurfaceFrame;
    if (!first.compactable) continue;
    // A tool frame at span start is only safe when its requester is inside:
    // requesters precede results, so a leading tool frame always orphans.
    if (first.role === "tool") continue;
    let tokens = 0;
    let weight = 0;
    const ids: string[] = [];
    for (let end = start; end < frames.length; end += 1) {
      const frame = frames[end] as SurfaceFrame;
      if (!frame.compactable) break;
      // Never end right after an assistant turn that requested tools when the
      // matching tool frame is the next frame (it would strand the pair).
      const next = frames[end + 1] as SurfaceFrame | undefined;
      tokens += frameTokens(frame, charsPerToken);
      weight += frameWeight(frame);
      ids.push(frame.id);
      if (frame.role === "assistant" && next !== undefined && next.role === "tool" && next.compactable) {
        continue;
      }
      if (tokens < targetTokens) continue;
      // Snapshot: the running  array keeps growing for longer spans below.
      const span: CompactionSpan = { start, end, tokens, ids: [...ids] };
      if (best === null || isBetterSpan(span, weight, best, bestWeight)) {
        best = span;
        bestWeight = weight;
      }
    }
  }
  return best;
}

/** Ordering of candidate spans: lighter first, then older, then smaller. */
function isBetterSpan(candidate: CompactionSpan, candidateWeight: number, best: CompactionSpan, bestWeight: number): boolean {
  if (candidateWeight !== bestWeight) return candidateWeight < bestWeight;
  if (candidate.start !== best.start) return candidate.start < best.start;
  return candidate.tokens < best.tokens;
}
