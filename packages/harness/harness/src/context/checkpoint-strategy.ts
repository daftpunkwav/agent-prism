/**
 * @file context/checkpoint-strategy
 * @description "checkpoint" context strategy backed by context-compaction.
 *
 * Responsibilities:
 * - Convert non-pinned messages into a compactable frame surface
 * - Select the oldest pair-safe span covering the overflow and condense it
 * - Fill the checkpoint extractively (deterministic; Summarizer stays a port)
 * - Replace the span with one rendered checkpoint system message
 *
 * Extractive fill keeps file paths, error lines, and tool names, so the model
 * keeps actionable specifics from dropped turns without the full transcripts.
 */

import {
  CompactionJournal,
  extractiveFill,
  renderCheckpoint,
  selectSpan,
  surfaceTokens,
  type Checkpoint,
  type SurfaceFrame,
} from "@agentprism/context-compaction";
import type { LlmMessage } from "@agentprism/contracts";
import { messageText } from "./message-text.js";

/** Overflow target that triggers compaction (estimated tokens to condense). */
export const CHECKPOINT_COMPACT_TARGET_TOKENS = 2_000;

/** Converts one message to a frame (user turns and the final exchange stay pinned). */
function toFrame(message: LlmMessage, index: number, total: number): SurfaceFrame {
  const role = message.role === "tool" || message.role === "assistant" || message.role === "user" || message.role === "system"
    ? message.role
    : "user";
  const isLatestUser = message.role === "user" && index >= total - 1;
  return {
    id: `m${index}`,
    role,
    text: messageText(message),
    weight: 1,
    compactable: !isLatestUser,
  };
}

/**
 * Single computation shared by the plain and journal-aware entry points:
 * frames, span, and checkpoint are built once so the audit trail can never
 * drift from the rewritten messages.
 */
function compactWithDetails(
  rest: readonly LlmMessage[],
  target: number,
): { messages: LlmMessage[]; span: NonNullable<ReturnType<typeof selectSpan>> | null; checkpoint: Checkpoint | null; spanTokens: number } {
  // One frame surface for everything below: toFrame flattens every message's
  // text and this runs on every LLM call under the checkpoint strategy, so
  // span selection and both token measurements must reuse it instead of
  // re-flattening the transcript.
  const frames = rest.map((m, i) => toFrame(m, i, rest.length));
  const totalTokens = surfaceTokens(frames);
  if (totalTokens <= target) {
    return { messages: [...rest], span: null, checkpoint: null, spanTokens: 0 };
  }
  const overflow = Math.max(0, totalTokens - target);
  const span = selectSpan(frames, Math.min(overflow, target));
  if (span === null) return { messages: [...rest], span: null, checkpoint: null, spanTokens: 0 };

  const spanFrames = frames.slice(span.start, span.end + 1);
  const spanTokens = surfaceTokens(spanFrames);
  // Extractive fill inline (sync pipeline): the Summarizer port stays a host
  // option for future async paths, the deterministic fill needs no model.
  const checkpoint: Checkpoint = {
    frameIds: spanFrames.map((frame) => frame.id),
    sections: extractiveFill(spanFrames),
    abstractive: false,
  };
  const rendered = renderCheckpoint(checkpoint);
  const checkpointMessage: LlmMessage = { role: "system", content: `[Context checkpoint]\n${rendered}` };
  const messages = [
    ...rest.slice(0, span.start),
    checkpointMessage,
    ...rest.slice(span.end + 1),
  ];
  return { messages, span, checkpoint, spanTokens };
}

/**
 * Condenses the oldest compactable span into a rendered checkpoint message.
 * Returns the rewritten messages plus whether compaction happened.
 */
export function applyCheckpointCompaction(
  rest: readonly LlmMessage[],
  options: { compactTargetTokens?: number } = {},
): { messages: LlmMessage[]; checkpointEmitted: boolean } {
  const { messages, checkpoint } = compactWithDetails(rest, options.compactTargetTokens ?? CHECKPOINT_COMPACT_TARGET_TOKENS);
  return { messages, checkpointEmitted: checkpoint !== null };
}

/**
 * Journal-aware compaction: runs the sync extractive path, then appends an
 * audit entry when a checkpoint was emitted. Journal failures never break the
 * pipeline (best-effort audit trail); sequence gaps throw inside the journal
 * and are swallowed here so concurrent callers cannot fail a turn.
 */
export function applyCheckpointCompactionWithJournal(
  rest: readonly LlmMessage[],
  journal: CompactionJournal,
  options: { compactTargetTokens?: number; now: number },
): { messages: LlmMessage[]; checkpointEmitted: boolean } {
  const applied = compactWithDetails(rest, options.compactTargetTokens ?? CHECKPOINT_COMPACT_TARGET_TOKENS);
  if (applied.checkpoint === null || applied.span === null) {
    return { messages: applied.messages, checkpointEmitted: false };
  }
  try {
    const afterTokens = Math.max(1, Math.ceil(renderCheckpoint(applied.checkpoint).length / 4));
    journal.append({ span: applied.span, checkpoint: applied.checkpoint, beforeTokens: applied.spanTokens, afterTokens, at: options.now });
  } catch {
    // Audit-only: a full or contended journal must not fail the turn.
  }
  return { messages: applied.messages, checkpointEmitted: true };
}
