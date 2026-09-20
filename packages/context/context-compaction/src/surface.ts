/**
 * @file context-compaction/surface
 * @description Turn-frame message surface with token metering and span selection.
 *
 * Responsibilities:
 * - Hold an ordered frame surface (one frame per turn segment)
 * - Meter frames with a char-proxy token estimate
 * - Select compaction spans (oldest compactable window) with pair safety
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

/** Characters per estimated token (conservative English/CJK blend). */
export const CHARS_PER_TOKEN = 4;

/** Token estimate for text via the char proxy. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

/** Token estimate for a frame (text plus a small role overhead). */
export function frameTokens(frame: SurfaceFrame): number {
  return estimateTokens(frame.text) + 4;
}

/** Total estimated tokens across frames. */
export function surfaceTokens(frames: readonly SurfaceFrame[]): number {
  return frames.reduce((sum, frame) => sum + frameTokens(frame), 0);
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

/**
 * Selects the oldest compactable span holding at least targetTokens.
 * Pair safety: a span never starts on a tool frame whose assistant turn sits
 * outside the span, and never ends between an assistant call and its tool
 * result. Pinned frames terminate spans. Returns null when nothing qualifies.
 */
export function selectSpan(frames: readonly SurfaceFrame[], targetTokens: number): CompactionSpan | null {
  if (targetTokens <= 0) return null;
  let best: CompactionSpan | null = null;
  for (let start = 0; start < frames.length; start += 1) {
    const first = frames[start] as SurfaceFrame;
    if (!first.compactable) continue;
    // A tool frame at span start is only safe when its requester is inside:
    // requesters precede results, so a leading tool frame always orphans.
    if (first.role === "tool") continue;
    let tokens = 0;
    const ids: string[] = [];
    for (let end = start; end < frames.length; end += 1) {
      const frame = frames[end] as SurfaceFrame;
      if (!frame.compactable) break;
      // Never end right after an assistant turn that requested tools when the
      // matching tool frame is the next frame (it would strand the pair).
      const next = frames[end + 1] as SurfaceFrame | undefined;
      tokens += frameTokens(frame);
      ids.push(frame.id);
      if (frame.role === "assistant" && next !== undefined && next.role === "tool" && next.compactable) {
        continue;
      }
      if (tokens >= targetTokens) {
        const span: CompactionSpan = { start, end, tokens, ids };
        if (best === null || span.tokens < best.tokens) best = span;
      }
    }
  }
  return best;
}
