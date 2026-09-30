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

/** Delay before the single read retry: AV scan locks and a save's rename-in-flight release a Windows file within tens of ms. */
const READ_RETRY_DELAY_MS = 50;

/**
 * Blocking nap before the sync read retry (server-side Node only; load() is a
 * synchronous API so the wait cannot be awaited). Atomics.wait is legal on the
 * Node main thread; an environment that forbids blocking waits skips the nap
 * and the retry below runs immediately instead.
 */
function napBeforeRetry(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // Blocking wait unavailable: retry immediately rather than skipping it.
  }
}

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

  /**
   * Loads from disk; falls back to the .env seed config when the file is missing/corrupted/structurally illegal.
   *
   * Two failure classes stay distinguishable: a missing file folds into null
   * (seed fallback is the documented first-boot path), while a thrown read gets
   * exactly one bounded retry before the fallback — on Windows most read faults
   * here are transient (AV scan lock, the rename of a concurrent save), and
   * falling back on a healthy file would swap every persisted endpoint id out
   * from under saved compositions, which then all surface as "unknown block"
   * with no visible cause. A self-healed retry stays silent: logging it would
   * spam the server log once per request in AV-heavy environments, and the
   * caller-visible config is already correct.
   */
  load(): ProviderConfig {
    let raw: unknown = null;
    try {
      try {
        raw = this.file.read<unknown>();
      } catch {
        napBeforeRetry(READ_RETRY_DELAY_MS);
        raw = this.file.read<unknown>();
      }
    } catch (error) {
      console.warn(`[providers] Config file read failed (retry exhausted); falling back to seed: ${error instanceof Error ? error.message : String(error)}`);
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

