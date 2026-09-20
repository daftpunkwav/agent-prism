/**
 * @file context-compaction/checkpoint
 * @description Tagged checkpoint envelopes with extractive fill and an LLM port.
 *
 * Responsibilities:
 * - Define the checkpoint section schema (intent/concepts/files/errors/pending/work/next)
 * - Fill sections extractively from compacted frames (deterministic fallback)
 * - Offer an async summarizer port for future LLM-backed fill
 *
 * Envelope format mirrors the durable-checkpoint convention: tagged sections
 * in fixed order, `(none)` for empty sections, never dropped sections. The
 * extractive fill keeps file paths, error lines, and tool names; the
 * `Summarizer` port lets a host replace the fill with model prose later
 * without changing envelope readers.
 */

import type { SurfaceFrame } from "./surface.js";

/** Fixed checkpoint sections in render order. */
export const CHECKPOINT_SECTIONS = [
  "intent",
  "concepts",
  "files",
  "errors",
  "pending",
  "work",
  "next",
] as const;

export type CheckpointSection = (typeof CHECKPOINT_SECTIONS)[number];

/** Envelope tags wrapping the rendered checkpoint. */
export const CHECKPOINT_OPEN_TAG = "<compacted-summary>";
export const CHECKPOINT_CLOSE_TAG = "</compacted-summary>";

/** One filled checkpoint: sections plus provenance. */
export interface Checkpoint {
  /** Frame ids condensed into this checkpoint. */
  frameIds: string[];
  /** Section name to bullet lines (possibly ["(none)"]). */
  sections: Record<CheckpointSection, string[]>;
  /** True when an LLM summarizer produced the fill (false = extractive). */
  abstractive: boolean;
}

/** Async summarizer port (host-supplied, e.g. an LLM call). */
export type Summarizer = (frames: SurfaceFrame[]) => Promise<Partial<Record<CheckpointSection, string[]>>>;

const ERROR_PATTERNS = ["ERROR", "Error", "error", "FAIL", "Failed", "failed", "FATAL", "Traceback", "panic", "ENOENT", "EACCES", "denied"];
const PATH_PATTERN = /[\w\-.~/][\w\-./~]{1,120}\.\w{1,8}/g;
const TOOL_PATTERN = /(?:called|tool|ran|executed)\s+([a-z][a-z0-9_-]*)/gi;

function uniq(lines: string[], cap: number): string[] {
  return [...new Set(lines.map((line) => line.trim()).filter((line) => line !== ""))].slice(0, cap);
}

/** Extractive section fill from frames (deterministic, dependency-free). */
export function extractiveFill(frames: SurfaceFrame[]): Record<CheckpointSection, string[]> {
  const users = frames.filter((f) => f.role === "user").map((f) => f.text);
  const assistants = frames.filter((f) => f.role === "assistant").map((f) => f.text);
  const tools = frames.filter((f) => f.role === "tool").map((f) => f.text);
  const all = [...users, ...assistants, ...tools].join("\n");
  const errorLines = all.split("\n").filter((line) => ERROR_PATTERNS.some((sig) => line.includes(sig)));
  const paths = [...new Set(all.match(PATH_PATTERN) ?? [])].slice(0, 8);
  const toolNames = [...new Set(
    assistants.flatMap((text) => [...text.matchAll(TOOL_PATTERN)].map((m) => m[1] as string)),
  )].slice(0, 8);
  const questions = users.map((text) => text.split("\n").find((line) => line.trim() !== "") ?? "").filter((line) => line !== "");
  return {
    intent: uniq(questions.slice(0, 3), 3).length > 0 ? uniq(questions.slice(0, 3), 3) : ["(none)"],
    concepts: toolNames.length > 0 ? [`tools in play: ${toolNames.join(", ")}`] : ["(none)"],
    files: paths.length > 0 ? paths.map((path) => `touched: ${path}`) : ["(none)"],
    errors: uniq(errorLines.slice(0, 5).map((line) => line.trim().slice(0, 200)), 5).length > 0
      ? uniq(errorLines.slice(0, 5).map((line) => line.trim().slice(0, 200)), 5)
      : ["(none)"],
    pending: ["(none)"],
    work: uniq(tools.slice(-2).map((text) => text.split("\n").find((line) => line.trim() !== "")?.trim().slice(0, 160) ?? ""), 2).length > 0
      ? uniq(tools.slice(-2).map((text) => text.split("\n").find((line) => line.trim() !== "")?.trim().slice(0, 160) ?? ""), 2)
      : ["(none)"],
    next: ["(none)"],
  };
}

/**
 * Builds a checkpoint for frames: extractive fill by default, or the host
 * summarizer when supplied (missing sections fall back to extractive lines).
 */
export async function buildCheckpoint(
  frames: SurfaceFrame[],
  options: { summarizer?: Summarizer } = {},
): Promise<Checkpoint> {
  const frameIds = frames.map((frame) => frame.id);
  const base = extractiveFill(frames);
  if (options.summarizer === undefined) {
    return { frameIds, sections: base, abstractive: false };
  }
  let overlay: Partial<Record<CheckpointSection, string[]>> = {};
  try {
    overlay = await options.summarizer(frames);
  } catch {
    overlay = {};
  }
  const sections = { ...base };
  for (const section of CHECKPOINT_SECTIONS) {
    const lines = overlay[section];
    if (lines !== undefined && lines.length > 0) sections[section] = lines.slice(0, 8);
  }
  return { frameIds, sections, abstractive: true };
}

/** Renders a checkpoint envelope (fixed section order, never dropped). */
export function renderCheckpoint(checkpoint: Checkpoint): string {
  const bodies = CHECKPOINT_SECTIONS.map((section) => `## ${section}\n${checkpoint.sections[section].join("\n")}`);
  return `${CHECKPOINT_OPEN_TAG}\n${bodies.join("\n\n")}\n${CHECKPOINT_CLOSE_TAG}`;
}

/** Parses a rendered envelope back into sections (null when malformed). */
export function parseCheckpoint(text: string): Record<CheckpointSection, string[]> | null {
  const open = text.indexOf(CHECKPOINT_OPEN_TAG);
  const close = text.indexOf(CHECKPOINT_CLOSE_TAG);
  if (open === -1 || close === -1 || close <= open) return null;
  const body = text.slice(open + CHECKPOINT_OPEN_TAG.length, close);
  const sections = {} as Record<CheckpointSection, string[]>;
  const heads = [...body.matchAll(/^## (\w+)\s*$/gm)];
  if (heads.length === 0) return null;
  for (let i = 0; i < heads.length; i += 1) {
    const name = heads[i]?.[1] as string;
    if (!(CHECKPOINT_SECTIONS as readonly string[]).includes(name)) return null;
    const start = (heads[i]?.index ?? 0) + (heads[i]?.[0]?.length ?? 0);
    const end = i + 1 < heads.length ? (heads[i + 1]?.index ?? body.length) : body.length;
    sections[name as CheckpointSection] = body
      .slice(start, end)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  }
  for (const section of CHECKPOINT_SECTIONS) {
    if (sections[section] === undefined) return null;
  }
  return sections;
}
