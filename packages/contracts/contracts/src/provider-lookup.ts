/**
 * @file provider-lookup
 * @description Port for querying provider configuration and endpoints.
 *
 * Responsibilities:
 * - Define endpoint/provider lookups for the Arena and orchestration layers
 *
 * Keeps callers off the providers storage/catalog implementations; the
 * concrete adapter is injected at the composition root.
 */

import type { LlmEndpoint, ProviderConfig } from "./provider-types.js";

export interface ProviderLookup {
  /** Loads the current provider config (caching is up to the implementation; the current adapter reads storage on every call). */
  load(): ProviderConfig;

  /** Rebuilds the endpoint catalog snapshot wholesale from the given config. */
  syncEndpointCatalog(provider: ProviderConfig): void;

  /** Looks up the catalog snapshot first, falling back to endpoints in the current config. */
  lookupEndpoint(endpointId: string, provider: ProviderConfig): LlmEndpoint | undefined;

  /** Lists all endpoints in the catalog snapshot. */
  listEndpoints(): LlmEndpoint[];
}
