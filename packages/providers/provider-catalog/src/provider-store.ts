/**
 * @file provider-store
 * @description Provider config repository with atomic saves and change events.
 *
 * Responsibilities:
 * - Load from file; fall back to the .env seed when corrupted
 * - Save atomically and emit change events
 *
 * Consumers sync derived state via listeners and never read the file directly.
 */

import type { IdGenerator, ProviderConfig } from "@agentprism/contracts";
import type { LlmEnvSeed } from "@agentprism/config";
import type { JsonFile } from "@agentprism/persistence";
import { parseProviderConfig } from "./provider-config.js";

export interface ProviderStoreOptions {
  /** JSON file port (the composition root injects AtomicJsonFile); business code never touches file IO directly. */
  file: JsonFile;
  envSeed: LlmEnvSeed;
  idGenerator: IdGenerator;
}

type ChangeListener = () => void;
/** Provider config repository: file load with .env-seed fallback, atomic saves, change events. */
export class ProviderConfigStore {
  private readonly file: JsonFile;
  private readonly envSeed: LlmEnvSeed;
  private readonly idGenerator: IdGenerator;
  private readonly listeners: ChangeListener[] = [];

  constructor(options: ProviderStoreOptions) {
    this.file = options.file;
    this.envSeed = options.envSeed;
    this.idGenerator = options.idGenerator;
  }

  /** Loads from disk; falls back to the .env seed config when the file is missing/corrupted/structurally illegal. */
  load(): ProviderConfig {
    let raw: unknown = null;
    try {
      // JsonFile.read already folds a missing file into null; other read/parse errors propagate — leave a trace then fall back
      raw = this.file.read<unknown>();
    } catch (error) {
      console.warn(`[providers] Config file read failed; falling back to seed: ${error instanceof Error ? error.message : String(error)}`);
      raw = null;
    }
    if (raw === null || raw === undefined) {
      return this.seedConfig();
    }
    try {
      return parseProviderConfig(raw, this.envSeed, this.idGenerator);
    } catch (error) {
      // Log only the type and first message line to avoid key leakage
      const message = error instanceof Error ? error.message.split("\n")[0] : "";
      console.warn(`[providers] Config load failed; falling back to .env seed: ${error instanceof Error ? error.name : "Error"} ${message}`);
      return this.seedConfig();
    }
  }

  /** Atomic save (concurrency serialized through the port); listeners are notified only after the write lands. */
  async save(config: ProviderConfig): Promise<void> {
    await this.file.write(config);
    this.notifyChanged();
  }

  addChangeListener(listener: ChangeListener): void {
    this.listeners.push(listener);
  }

  notifyChanged(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.warn(`[providers] Change listener error: ${error instanceof Error ? error.name : "Error"}`);
      }
    }
  }

  private seedConfig(): ProviderConfig {
    const seed = this.envSeed;
    return parseProviderConfig(
      {
        provider_name: seed.providerName,
        api_key: seed.apiKey,
        base_url: seed.baseUrl,
        model: seed.model,
        api_format: seed.apiFormat,
      },
      seed,
      this.idGenerator,
    );
  }
}

