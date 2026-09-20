/**
 * @file json-store
 * @description Atomic JSON persistence with concurrent-write serialization.
 *
 * Responsibilities:
 * - Replace files atomically via tmp + .bak backup + rename
 * - Serialize concurrent async writes per path (async only; sync calls are inherently serialized) through a write queue
 */

import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Reads a JSON file; returns null when missing, throws a JSONDecodeError-style
 * SyntaxError on corrupted content; other IO errors propagate.
 * Corruption recovery: every atomic write leaves a .bak of the last good payload,
 * so a parse failure falls back to it (loudly) before giving up.
 */
export function readJsonFile<T>(filePath: string): T | null {
  try {
    const text = readFileSync(filePath, "utf-8");
    return JSON.parse(text) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      try {
        const backup = JSON.parse(readFileSync(`${filePath}.bak`, "utf-8")) as T;
        console.warn(`[persistence] ${filePath} is corrupt; recovered from ${filePath}.bak`);
        return backup;
      } catch {
        // Backup missing or corrupt too: fall through and report the original failure.
      }
    }
    throw error;
  }
}

/**
 * Decides whether the current main file may become the .bak recovery point.
 * A corrupt main must never be cloned over the last good backup: skip loudly and
 * keep the previous .bak. Missing file on first write stays silent (no backup exists).
 */
function backupHealthySync(filePath: string): boolean {
  let text: string;
  try {
    text = readFileSync(filePath, "utf-8");
  } catch (error) {
    // The original file being absent on first write is a normal path; other backup failures must leave a trace (no rollback point after corruption)
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[persistence] Backup read failed ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return false;
  }
  try {
    JSON.parse(text);
    return true;
  } catch {
    console.warn(`[persistence] ${filePath} is corrupt; keeping the previous .bak instead of cloning corruption`);
    return false;
  }
}

/**
 * Atomic JSON write: tmp file + .bak backup + rename replace.
 * A failed backup does not block the main flow; a failed write propagates so the caller decides on rollback.
 */
export function atomicWriteJson(filePath: string, payload: unknown, options: { backup?: boolean } = {}): void {
  const backup = options.backup ?? true;
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  if (backup && backupHealthySync(filePath)) {
    try {
      copyFileSync(filePath, `${filePath}.bak`);
    } catch (error) {
      console.warn(`[persistence] Backup failed ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  renameSync(tmpPath, filePath);
}

/**
 * Serializes async writes per target path: the async writeFile/rename yield the event
 * loop, and without queuing two concurrent writes sharing the same .tmp file would
 * tear each other apart (ENOENT on the latter's rename, or interleaved content).
 * Map entries self-clean once the head write finishes; they do not grow with path count.
 */
const writeQueues = new Map<string, Promise<void>>();

/**
 * Async version of the atomic JSON write (same semantics as atomicWriteJson, plus
 * guaranteed per-file ordering of concurrent writes).
 * Used by request paths writing large payloads to disk without blocking the event loop.
 */
export async function atomicWriteJsonAsync(filePath: string, payload: unknown, options: { backup?: boolean } = {}): Promise<void> {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const job = previous.catch(() => {}).then(() => doAtomicWriteJsonAsync(filePath, payload, options));
  writeQueues.set(filePath, job);
  try {
    await job;
  } finally {
    if (writeQueues.get(filePath) === job) {
      writeQueues.delete(filePath);
    }
  }
}

async function doAtomicWriteJsonAsync(filePath: string, payload: unknown, options: { backup?: boolean }): Promise<void> {
  const backup = options.backup ?? true;
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  if (backup && backupHealthySync(filePath)) {
    try {
      await copyFile(filePath, `${filePath}.bak`);
    } catch (error) {
      console.warn(`[persistence] Backup failed ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await rename(tmpPath, filePath);
}
