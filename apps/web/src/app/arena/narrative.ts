/**
 * @file narrative
 * @description Backend comparison-narrative parsing for the comparison report.
 *
 * Responsibilities:
 * - Split a narrative into the prose body and its [Ablation] grounding suffix
 * - Recover prose from legacy narratives that dumped raw LLM content blocks
 *
 * Pure string logic: no React, no I/O; unit-testable in isolation.
 */

/** Splits the backend narrative into prose body vs the [Ablation] grounding suffix. */
export function splitNarrative(narrative: string): { body: string; ablation: string } {
  const marker = "[Ablation]";
  const index = narrative.indexOf(marker);
  if (index === -1) return { body: narrative.trim(), ablation: "" };
  return {
    body: narrative.slice(0, index).trim(),
    ablation: narrative.slice(index + marker.length).trim(),
  };
}

/**
 * Cleans legacy narratives that dumped raw LLM content blocks
 * (`[{type:"thinking",…},{type:"text",text:"…"}]`) instead of prose.
 * Best-effort JSON recovery; falls back to the raw text when unparseable.
 */
export function cleanNarrativeBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return body;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const blocks = Array.isArray(parsed) ? parsed : [parsed];
    const texts: string[] = [];
    for (const block of blocks) {
      if (typeof block === "string") {
        if (block.trim() !== "") texts.push(block);
      } else if (block !== null && typeof block === "object") {
        const record = block as Record<string, unknown>;
        if (
          (record.type === "thinking" || record.type === "reasoning" || record.type === "redacted_thinking") &&
          typeof record.text !== "string"
        ) {
          continue;
        }
        if (typeof record.text === "string" && record.text.trim() !== "") texts.push(record.text);
      }
    }
    return texts.length > 0 ? texts.join("\n\n") : body;
  } catch {
    return body;
  }
}
