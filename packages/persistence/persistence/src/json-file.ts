/**
 * @file json-file
 * @description Storage port so business code never touches file IO directly.
 *
 * Responsibilities:
 * - Define the JsonFile read/write contract
 * - Provide the AtomicJsonFile implementation backed by json-store
 */

import { atomicWriteJsonAsync, readJsonFile } from "./json-store.js";

export interface JsonFile {
  read<T>(): T | null;
  write(payload: unknown): Promise<void>;
}

/** Atomic JSON file write implementation (tmp + .bak backup + rename replace). */
export class AtomicJsonFile implements JsonFile {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  read<T>(): T | null {
    return readJsonFile<T>(this.filePath);
  }

  async write(payload: unknown): Promise<void> {
    await atomicWriteJsonAsync(this.filePath, payload);
  }
}
