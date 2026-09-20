/**
 * @file context-chunking/text
 * @description Plain-text chunking: paragraphs, CJK sentences, overlap windows.
 *
 * Responsibilities:
 * - Split long text into bounded chunks on paragraph/sentence boundaries
 * - Emit overlap windows so retrievers see cross-boundary context
 *
 * Deterministic and dependency-free. CJK sentence punctuation (。！？) splits
 * like Latin (.!?) so Chinese documents chunk on sentence boundaries too.
 * Offsets are tracked by forward scanning, so repeated passages map correctly.
 */

export interface TextChunk {
  content: string;
  /** Offset of the chunk start in the source text. */
  start: number;
  /** Offset of the chunk end (exclusive). */
  end: number;
}

/** Default max chunk size in characters. */
export const TEXT_MAX_CHUNK = 1200;

/** Default overlap between consecutive chunks in characters. */
export const TEXT_OVERLAP = 200;

/** Yields non-empty paragraphs with source offsets. */
function paragraphs(text: string): Array<{ content: string; start: number }> {
  const out: Array<{ content: string; start: number }> = [];
  const pattern = /\n\s*\n/g;
  let start = 0;
  let match: RegExpExecArray | null;
  const flush = (end: number): void => {
    const content = text.slice(start, end);
    if (content.trim() !== "") out.push({ content, start });
  };
  while ((match = pattern.exec(text)) !== null) {
    flush(match.index);
    start = match.index + match[0].length;
  }
  flush(text.length);
  return out;
}

/** Splits one over-long paragraph into sentence-bounded pieces with offsets. */
function sentences(paragraph: string, base: number, maxChars: number): TextChunk[] {
  const out: TextChunk[] = [];
  const ender = /([。！？.!?]["')」』]?\s*)/g;
  let current = "";
  let currentStart = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  const pushCurrent = (): void => {
    if (current === "") return;
    // Hard-cut pathological single sentences (never drop content).
    if (current.length <= maxChars) {
      out.push({ content: current, start: base + currentStart, end: base + currentStart + current.length });
      return;
    }
    for (let at = 0; at < current.length; at += maxChars) {
      out.push({ content: current.slice(at, at + maxChars), start: base + currentStart + at, end: base + currentStart + Math.min(current.length, at + maxChars) });
    }
  };
  while ((match = ender.exec(paragraph)) !== null) {
    const end = match.index + match[0].length;
    const sentence = paragraph.slice(cursor, end);
    if ((current + sentence).length <= maxChars || current === "") {
      if (current === "") currentStart = cursor;
      current += sentence;
    } else {
      pushCurrent();
      current = sentence;
      currentStart = cursor;
    }
    cursor = end;
  }
  const rest = paragraph.slice(cursor);
  if (rest !== "") {
    if ((current + rest).length <= maxChars || current === "") {
      if (current === "") currentStart = cursor;
      current += rest;
    } else {
      pushCurrent();
      current = rest;
      currentStart = cursor;
    }
  }
  pushCurrent();
  return out;
}

/**
 * Chunks text into bounded pieces with character overlap.
 * Short text yields one chunk; empty text yields none.
 */
export function chunkText(
  text: string,
  options: { maxChars?: number; overlap?: number } = {},
): TextChunk[] {
  const maxChars = Math.max(200, options.maxChars ?? TEXT_MAX_CHUNK);
  const overlap = Math.min(Math.floor(maxChars / 2), Math.max(0, options.overlap ?? TEXT_OVERLAP));
  if (text === "") return [];
  const units: TextChunk[] = [];
  for (const paragraph of paragraphs(text)) {
    if (paragraph.content.length <= maxChars) {
      units.push({ content: paragraph.content, start: paragraph.start, end: paragraph.start + paragraph.content.length });
    } else {
      units.push(...sentences(paragraph.content, paragraph.start, maxChars));
    }
  }
  if (units.length <= 1) return units;
  // Merge small neighbors, then rewind overlap tails across chunk boundaries.
  const merged: TextChunk[] = [];
  let current = units[0] as TextChunk;
  for (const unit of units.slice(1)) {
    if ((current.content + "\n\n" + unit.content).length <= maxChars) {
      current = { content: `${current.content}\n\n${unit.content}`, start: current.start, end: unit.end };
    } else {
      merged.push(current);
      current = unit;
    }
  }
  merged.push(current);
  if (overlap === 0 || merged.length <= 1) return merged;
  return merged.map((chunk, index) => {
    if (index === 0) return chunk;
    const prev = merged[index - 1] as TextChunk;
    const tail = prev.content.slice(-overlap);
    if (chunk.content.startsWith(tail)) return chunk;
    const content = `${tail}\n\n${chunk.content}`.slice(-(maxChars + overlap));
    return { content, start: Math.max(0, chunk.start - overlap), end: chunk.end };
  });
}
