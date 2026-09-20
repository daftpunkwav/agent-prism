/**
 * @file append-file
 * @description Append-only line-file port with a node implementation.
 *
 * Responsibilities:
 * - Define the AppendFile contract (append lines, read lines, truncate)
 * - Ship the atomic-truncate + append node backend
 *
 * AppendFile owns line-oriented disk IO (JSONL journals, logs) the same way
 * JsonFile owns document IO: business code never touches node:fs directly.
 * Appends serialize through a per-path queue so concurrent async appends
 * never interleave mid-line.
 */

import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Append-only line file contract. */
export interface AppendFile {
  /** Appends lines (each without trailing newline; newline added on write). */
  append(lines: string[]): Promise<void>;
  /** Reads all lines (no trailing-newline artifacts; missing file yields []). */
  readLines(): Promise<string[]>;
  /** Atomically replaces content with the given lines. */
  rewrite(lines: string[]): Promise<void>;
}

const queues = new Map<string, Promise<void>>();

function enqueue(path: string, task: () => Promise<void>): Promise<void> {
  const tail = queues.get(path) ?? Promise.resolve();
  const next = tail.then(task, task);
  queues.set(path, next);
  return next;
}

/** Node-backed AppendFile over one file path (creates parent dirs on demand). */
export class NodeAppendFile implements AppendFile {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  append(lines: string[]): Promise<void> {
    const payload = lines.map((line) => `${line}\n`).join("");
    return enqueue(this.filePath, async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, payload, "utf-8");
    });
  }

  async readLines(): Promise<string[]> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
      throw error;
    }
    if (text === "") return [];
    const lines = text.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines;
  }

  rewrite(lines: string[]): Promise<void> {
    const payload = lines.map((line) => `${line}\n`).join("");
    return enqueue(this.filePath, async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, payload, "utf-8");
      await rename(tmp, this.filePath);
    });
  }
}
