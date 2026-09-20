/**
 * @file context-chunking/chunk
 * @description Auto-routing file chunker with uniform chunk records.
 *
 * Responsibilities:
 * - Route file content to the code/markdown/text splitter by extension
 * - Attach file path, language, and offsets to every chunk record
 *
 * The single entry ingestion and retrieval share: chunk once with language
 * metadata, score many times against queries.
 */

import { chunkCode, type CodeChunk } from "./code.js";
import { chunkMarkdown } from "./markdown.js";
import { chunkText } from "./text.js";

export interface FileChunk {
  /** Workspace-relative file path the chunk came from. */
  path: string;
  /** Detected language key (extension without dot, `md`, or `text`). */
  language: string;
  /** Chunk content. */
  content: string;
  /** Human-readable location (line range or char offsets). */
  location: string;
  /** Symbol or section context when available. */
  context: string | null;
}

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);
const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "py", "go", "rs",
  "java", "kt", "rb", "php", "swift", "c", "h", "cpp", "hpp", "cs", "scala",
  "sh", "bash", "yaml", "yml", "json", "toml", "css", "html", "vue", "svelte",
]);

function languageOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  const ext = dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
  if (ext === "") return "text";
  if (MARKDOWN_EXTENSIONS.has(ext)) return "md";
  return ext;
}

/**
 * Chunks one file into uniform records (empty content yields none).
 * Code files split on definitions, markdown on headers, the rest as text.
 */
export function chunkFile(path: string, content: string): FileChunk[] {
  if (content.trim() === "") return [];
  const language = languageOf(path);
  if (language === "md") {
    return chunkMarkdown(content).map((chunk) => ({
      path,
      language,
      content: chunk.content,
      location: `L${chunk.startLine}`,
      context: chunk.section === "" ? null : chunk.section,
    }));
  }
  if (CODE_EXTENSIONS.has(language)) {
    const chunks: FileChunk[] = [];
    for (const chunk of chunkCode(content, { parentSymbol: path }) as CodeChunk[]) {
      chunks.push({
        path,
        language,
        content: chunk.content,
        location: `L${chunk.startLine}-${chunk.endLine}`,
        context: chunk.symbol,
      });
    }
    return chunks;
  }
  return chunkText(content).map((chunk) => ({
    path,
    language,
    content: chunk.content,
    location: `chars ${chunk.start}-${chunk.end}`,
    context: null,
  }));
}
