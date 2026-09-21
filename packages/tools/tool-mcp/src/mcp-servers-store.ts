/**
 * @file mcp-servers-store
 * @description Persistent MCP server registry with hot-apply into a shared list.
 *
 * Responsibilities:
 * - Persist the operator-managed server list to one JSON file
 * - Seed from the MCP_SERVERS env parse on first run (no file yet), keeping the
 *   env-only behavior backward compatible
 * - Apply every change in place into a caller-owned shared array so consumers
 *   that read it per run (builder turns, arena columns) hot-reload without restart
 *
 * The store takes its persistence and filesystem ports by injection; the server
 * assembly wires AtomicJsonFile + node:fs. Parsing reuses parseMcpServersEnv so
 * validation never drifts between env and managed sources.
 */

import { parseMcpServersEnv } from "./config.js";
import type { McpServerConfig } from "./client.js";

/** JSON persistence port (AtomicJsonFile-compatible shape). */
export interface McpStoreFile {
  read(): unknown;
  write(value: unknown): void;
  exists(): boolean;
}

/** Rendering port for persisting the list (JSON.stringify in production). */
export interface McpStoreCodec {
  encode(value: unknown): string;
  decode(raw: string): unknown;
}

/** JSON codec used unless a caller injects another. */
const jsonCodec: McpStoreCodec = {
  encode: (value) => JSON.stringify(value, null, 2),
  decode: (raw) => JSON.parse(raw) as unknown,
};

export interface McpServersStoreOptions {
  file: McpStoreFile;
  /** Env-parsed seed list used only when the store file does not exist yet. */
  seed: readonly McpServerConfig[];
  codec?: McpStoreCodec;
}

/** Validation error carrying an operator-readable message (routes map to 400). */
export class McpStoreError extends Error {}

/**
 * Persistent MCP server registry. `servers` is a stable array instance that is
 * mutated in place on every change — hold a reference once and read it per run.
 */
export class McpServersStore {
  private readonly file: McpStoreFile;
  private readonly codec: McpStoreCodec;
  /** Shared, in-place-mutated list consumed per run by the execution layers. */
  readonly servers: McpServerConfig[] = [];

  constructor(options: McpServersStoreOptions) {
    this.file = options.file;
    this.codec = options.codec ?? jsonCodec;
    try {
      if (options.file.exists()) {
        const raw = this.file.read();
        const text = typeof raw === "string" ? raw : this.codec.encode(raw);
        this.servers.push(...this.parseList(text));
        return;
      }
    } catch (error) {
      // A corrupt store must not kill the server: fall back to the env seed and
      // leave the file untouched so the operator can inspect it.
      console.warn("[mcp-store] store file unreadable; using env seed:", error instanceof Error ? error.message : error);
    }
    this.servers.push(...options.seed);
  }

  /** Validates one serialized list through the shared env parser. */
  private parseList(text: string): McpServerConfig[] {
    try {
      return parseMcpServersEnv(text);
    } catch (error) {
      throw new McpStoreError(error instanceof Error ? error.message : String(error));
    }
  }

  /** Replaces the whole list (normalized, persisted, hot-applied in place). */
  replace(input: readonly McpServerConfig[]): McpServerConfig[] {
    const next = this.parseList(this.codec.encode(input));
    this.servers.splice(0, this.servers.length, ...next);
    this.file.write(next);
    return [...this.servers];
  }

  /** Current list snapshot (for the settings view). */
  list(): McpServerConfig[] {
    return [...this.servers];
  }
}
