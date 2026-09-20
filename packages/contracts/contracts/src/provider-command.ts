/**
 * @file provider-command
 * @description Application-facing port for provider admin operations.
 *
 * Responsibilities:
 * - Define parse, public projection, key merge, and connectivity-test ports
 *
 * Implementations live in the providers package, wired at the composition root.
 */

import type { ConnectionTestResult, LlmEndpointUpdateInput, ProviderConfigPublic } from "./provider.js";
import type { LlmEndpoint, ProviderConfig } from "./provider-types.js";
import type { IdGenerator } from "./ports.js";

/** Target for a connectivity probe (explicit endpoints or legacy flat fields). */
export interface ConnectionTestTarget {
  testEndpointId?: string;
  endpoints?: LlmEndpointUpdateInput[];
  legacy?: LlmEndpointUpdateInput & { models?: string[] };
}

/**
 * Provider admin commands used by ProviderService. Seed/env details are closed
 * over by the composition-root adapter so application stays free of providers.
 */
export interface ProviderCommand {
  toPublic(config: ProviderConfig): ProviderConfigPublic;
  mergeEndpointKeys<T extends { id: string; base_url: string; api_format: string; api_key: string }>(
    incoming: T[],
    stored: Array<{ id: string; base_url: string; api_format: string; api_key: string }>,
  ): T[];
  endpointUpdateToEntity(update: LlmEndpointUpdateInput, ids: IdGenerator): LlmEndpoint;
  /** Parses and clamps a raw update payload; seed is closed over by the adapter. */
  parseConfig(raw: unknown, ids: IdGenerator): ProviderConfig;
  testConnection(provider: ProviderConfig, target: ConnectionTestTarget | null): Promise<ConnectionTestResult>;
}

/** Persistence port for provider config (load/save). */
export interface ProviderConfigRepository {
  load(): ProviderConfig;
  save(config: ProviderConfig): Promise<void>;
}
