/**
 * @file context-chunking/markdown
 * @description Markdown chunking along the header hierarchy.
 *
 * Responsibilities:
 * - Split documents on ATX headers, keeping section paths as context
 * - Chunk over-long sections with the text splitter, preserving headers
 *
 * Each chunk carries its section path (e.g. `Guide > Context`) so retrieval
 * hits stay interpretable without re-reading the whole document. Fenced code
 * blocks are never split mid-fence: a fence that would straddle a boundary
 * moves wholly into the next chunk.
 */

import { chunkText } from "./text.js";

export interface MarkdownChunk {
  content: string;
  /** Section path from `#` to the deepest header above the chunk. */
  section: string;
  /** 1-based start line of the chunk in the source document. */
  startLine: number;
}

interface Section {
  level: number;
  title: string;
  startLine: number;
  lines: string[];
}

/** Splits lines into header-delimited sections (preamble becomes level-7). */
function splitSections(lines: string[]): Section[] {
  const sections: Section[] = [];
  let current: Section = { level: 7, title: "", startLine: 1, lines: [] };
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (/^(`{3,}|~{3,})/.test(line.trim())) inFence = !inFence;
    const header = !inFence ? /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (header !== null) {
      if (current.lines.some((l) => l.trim() !== "") || current.title !== "") sections.push(current);
      current = { level: header[1]?.length ?? 7, title: (header[2] ?? "").trim(), startLine: i + 1, lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.some((l) => l.trim() !== "") || current.title !== "") sections.push(current);
  return sections;
}

/**
 * Splits a section body into fence-atomic segments: fenced code spans travel
 * as single units (splitting mid-fence corrupts both halves for retrieval).
 * An over-long fence becomes one over-budget chunk rather than two halves.
 */
function fenceSegments(body: string): string[] {
  const segments: string[] = [];
  const lines = body.split("\n");
  let current: string[] = [];
  let inFence = false;
  const flush = (): void => {
    if (current.some((line) => line.trim() !== "")) segments.push(current.join("\n"));
    current = [];
  };
  for (const line of lines) {
    if (/^(`{3,}|~{3,})/.test(line.trim())) {
      if (!inFence) flush();
      current.push(line);
      inFence = !inFence;
      if (!inFence) flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return segments;
}

/**
 * Chunks a markdown document along its header hierarchy.
 * Sections under maxChars yield one chunk; larger sections split with the
 * section path prepended so split chunks keep their context. Fence spans
 * stay atomic across every split.
 */
export function chunkMarkdown(text: string, options: { maxChars?: number } = {}): MarkdownChunk[] {
  const maxChars = Math.max(400, options.maxChars ?? 2000);
  if (text.trim() === "") return [];
  const lines = text.split("\n");
  const sections = splitSections(lines);
  const stack: Section[] = [];
  const out: MarkdownChunk[] = [];
  for (const section of sections) {
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 7) >= section.level) stack.pop();
    if (section.title !== "") stack.push(section);
    const path = stack.map((s) => s.title).filter((t) => t !== "").join(" > ");
    const body = section.lines.join("\n");
    if (body.length <= maxChars) {
      out.push({ content: body, section: path, startLine: section.startLine });
      continue;
    }
    // Pack fence-atomic segments greedily; oversized segments fall back to
    // the text splitter (plain prose) or ride whole (over-long fences).
    const packed: string[] = [];
    let current = "";
    const flushCurrent = (): void => {
      if (current.trim() !== "") packed.push(current);
      current = "";
    };
    for (const segment of fenceSegments(body)) {
      if (segment.length > maxChars && !segment.trimStart().startsWith("```") && !segment.trimStart().startsWith("~~~")) {
        flushCurrent();
        for (const piece of chunkText(segment, { maxChars })) packed.push(piece.content);
        continue;
      }
      if (current !== "" && (current + "\n\n" + segment).length > maxChars) flushCurrent();
      current = current === "" ? segment : `${current}\n\n${segment}`;
    }
    flushCurrent();
    let consumed = 0;
    for (const content of packed) {
      const at = body.indexOf(content.slice(0, Math.min(48, content.length)), consumed);
      const start = at === -1 ? consumed : at;
      const offsetLines = body.slice(0, start).split("\n").length - 1;
      out.push({
        content: path === "" ? content : `[${path}]\n${content}`,
        section: path,
        startLine: section.startLine + offsetLines,
      });
      consumed = start + 1;
    }
  }
  return out;
}
