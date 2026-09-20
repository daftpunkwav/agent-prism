/**
 * @file catalog
 * @description In-memory endpoint catalog rebuilt wholesale on config changes.
 *
 * Responsibilities:
 * - Snapshot endpoints per provider config revision
 * - Resolve endpoint_id lookups for the Arena side
 *
 * Created and injected at the composition root.
 */

import type { LlmEndpoint, ProviderConfig } from "@agentprism/contracts";

/** Known LLM endpoint directory backing provider lookups. */
export class EndpointCatalog {
  private endpoints = new Map<string, LlmEndpoint>();

  /** Rebuilds the catalog wholesale from the given config. */
  sync(provider: ProviderConfig): void {
    const next = new Map<string, LlmEndpoint>();
    for (const endpoint of provider.endpoints) {
      next.set(endpoint.id, endpoint);
    }
    this.endpoints = next;
  }

  /** Looks up the catalog snapshot first, falling back to the current config. */
  lookup(endpointId: string, provider: ProviderConfig): LlmEndpoint | undefined {
    return this.endpoints.get(endpointId) ?? provider.endpoints.find((endpoint) => endpoint.id === endpointId);
  }

  list(): LlmEndpoint[] {
    return [...this.endpoints.values()];
  }
}

/** Endpoint lookup by id: catalog snapshot first, falling back to the current config (the canonical fallback rule: snapshot first, then config; EndpointCatalog.lookup implements it, lookupEndpoint delegates to it). */
export function lookupEndpoint(
  endpointId: string | null | undefined,
  provider: ProviderConfig,
  catalog?: EndpointCatalog,
): LlmEndpoint | undefined {
  if (endpointId === null || endpointId === undefined || endpointId === "") return undefined;
  return catalog !== undefined
    ? catalog.lookup(endpointId, provider)
    : provider.endpoints.find((endpoint) => endpoint.id === endpointId);
}
