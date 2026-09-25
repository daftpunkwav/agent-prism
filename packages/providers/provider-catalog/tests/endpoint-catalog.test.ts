/**
 * @file endpoint catalog tests
 * @description Locks snapshot sync and snapshot-first lookup with config fallback.
 */

import { describe, expect, it } from "vitest";
import type { LlmEndpoint, ProviderConfig } from "@agentprism/contracts";
import { EndpointCatalog, lookupEndpoint } from "../src/catalog.js";

function endpoint(id: string): LlmEndpoint {
  return { id } as LlmEndpoint;
}

function config(...ids: string[]): ProviderConfig {
  return { endpoints: ids.map(endpoint) } as ProviderConfig;
}

describe("EndpointCatalog", () => {
  it("sync replaces the snapshot wholesale", () => {
    const catalog = new EndpointCatalog();
    catalog.sync(config("a", "b"));
    expect(catalog.list().map((entry) => entry.id).sort()).toEqual(["a", "b"]);
    catalog.sync(config("c"));
    expect(catalog.list().map((entry) => entry.id)).toEqual(["c"]);
  });

  it("lookup prefers the snapshot, then the live config", () => {
    const catalog = new EndpointCatalog();
    catalog.sync(config("a"));
    expect(catalog.lookup("a", config("a", "b"))?.id).toBe("a");
    expect(catalog.lookup("b", config("a", "b"))?.id).toBe("b");
    expect(catalog.lookup("ghost", config("a"))).toBeUndefined();
  });
});

describe("lookupEndpoint", () => {
  it("rejects blank ids without touching the catalog", () => {
    expect(lookupEndpoint("", config("a"))).toBeUndefined();
    expect(lookupEndpoint(null, config("a"))).toBeUndefined();
    expect(lookupEndpoint(undefined, config("a"))).toBeUndefined();
  });

  it("delegates to the catalog when provided", () => {
    const catalog = new EndpointCatalog();
    catalog.sync(config("a"));
    expect(lookupEndpoint("a", config(), catalog)?.id).toBe("a");
  });
});
