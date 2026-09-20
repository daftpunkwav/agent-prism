/**
 * @file context-instructions/render
 * @description Budget-aware rendering of instruction layers into prompt text.
 *
 * Responsibilities:
 * - Order layers by precedence and render fenced sections
 * - Truncate over-budget layers with loud markers (never silently)
 *
 * Rendering is deterministic: same layers and budget always yield the same
 * text. Bundled layers render first (stable foundation), then repo, then
 * workspace overrides, so the highest-precedence guidance lands last where
 * instruction-following models weight it most.
 */

import type { InstructionLayer } from "./sources.js";

/** Default total budget for the rendered instruction block. */
export const INSTRUCTIONS_MAX_CHARS = 6000;

/** Per-layer body cap before truncation markers kick in. */
export const INSTRUCTION_LAYER_MAX_CHARS = 2500;

const SOURCE_ORDER: Record<InstructionLayer["source"], number> = {
  bundled: 0,
  repo: 1,
  workspace: 2,
};

export interface RenderedInstructions {
  text: string;
  /** Layers included in order. */
  layers: string[];
  /** Layers truncated to fit (with per-layer kept/total counts). */
  truncated: Array<{ name: string; kept: number; total: number }>;
}

/**
 * Renders layers into one prompt block (empty string when no layers).
 * Over-budget bodies keep head + tail with a marker; the whole block keeps
 * a head-biased slice with its own marker when layers collectively overflow.
 */
export function renderInstructions(
  layers: readonly InstructionLayer[],
  budget: number = INSTRUCTIONS_MAX_CHARS,
): RenderedInstructions {
  const ordered = [...layers].sort(
    (a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || (a.name < b.name ? -1 : 1),
  );
  const sections: string[] = [];
  const included: string[] = [];
  const truncated: RenderedInstructions["truncated"] = [];
  for (const layer of ordered) {
    included.push(layer.name);
    let body = layer.body.trim();
    if (body.length > INSTRUCTION_LAYER_MAX_CHARS) {
      const tail = Math.min(500, Math.floor(INSTRUCTION_LAYER_MAX_CHARS / 5));
      const marker = `\n…[instruction truncated: ${body.length} chars]…\n`;
      const head = INSTRUCTION_LAYER_MAX_CHARS - tail - marker.length;
      truncated.push({ name: layer.name, kept: INSTRUCTION_LAYER_MAX_CHARS, total: body.length });
      body = head > 0
        ? `${body.slice(0, head)}${marker}${body.slice(body.length - tail)}`
        : `${body.slice(0, INSTRUCTION_LAYER_MAX_CHARS)}\n…(truncated)`;
    }
    sections.push(`## ${layer.name}\n${body}`);
  }
  if (sections.length === 0) return { text: "", layers: [], truncated: [] };
  let text = `[Agent instructions]\n${sections.join("\n\n")}`;
  if (text.length > budget) {
    const marker = `\n…[instructions capped: ${text.length} chars > ${budget} budget]…`;
    text = text.slice(0, Math.max(0, budget - marker.length)) + marker;
  }
  return { text, layers: included, truncated };
}
