/**
 * @file provider-lookup-adapter
 * @description Bridges the providers package to the contracts ProviderLookup port.
 *
 * Responsibilities:
 * - Adapt concrete endpoint lookups to the port interface
 *
 * Created at the composition root and injected into the Arena.
 */

import type { LlmEndpoint, ProviderConfig, ProviderLookup } from "@agentprism/contracts";
import type { EndpointCatalog } from "./catalog.js";
import type { ProviderConfigStore } from "./provider-store.js";
import { lookupEndpoint } from "./catalog.js";
/** ProviderLookup port over the config store plus endpoint catalog. */
export class ProviderLookupAdapter implements ProviderLookup {
  private readonly store: ProviderConfigStore;
  private readonly catalog: EndpointCatalog;

  constructor(store: ProviderConfigStore, catalog: EndpointCatalog) {
    this.store = store;
    this.catalog = catalog;
  }

  load(): ProviderConfig {
    return this.store.load();
  }

  syncEndpointCatalog(provider: ProviderConfig): void {
    this.catalog.sync(provider);
  }

  lookupEndpoint(endpointId: string, provider: ProviderConfig): LlmEndpoint | undefined {
    return lookupEndpoint(endpointId, provider, this.catalog);
  }

  listEndpoints(): LlmEndpoint[] {
    return this.catalog.list();
  }
}
