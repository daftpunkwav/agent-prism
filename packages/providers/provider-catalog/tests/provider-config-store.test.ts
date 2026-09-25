/**
 * @file provider config store tests
 * @description Locks seed fallback, atomic save notification, and listener isolation.
 */

import { describe, expect, it, vi } from "vitest";
import type { LlmEnvSeed } from "@agentprism/config";
import type { JsonFile } from "@agentprism/persistence";
import { ProviderConfigStore } from "../src/provider-store.js";

function seed(): LlmEnvSeed {
  return {
    providerName: "seed-provider",
    apiKey: "",
    baseUrl: "",
    model: "seed-model",
    apiFormat: "anthropic_messages",
    temperature: 0.2,
  };
}

function storeWith(file: JsonFile) {
  return new ProviderConfigStore({ file, envSeed: seed(), idGenerator: { next: () => "id1" } });
}

describe("ProviderConfigStore.load", () => {
  it("falls back to the env seed when the file is missing", () => {
    const store = storeWith({ read: () => null, write: async () => {} });
    const config = store.load();
    expect(config.provider_name).toBe("seed-provider");
    expect(config.model).toBe("seed-model");
  });

  it("falls back to the env seed when reads throw", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const store = storeWith({
        read: () => {
          throw new Error("disk gone");
        },
        write: async () => {},
      });
      expect(store.load().provider_name).toBe("seed-provider");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("ProviderConfigStore.save", () => {
  it("writes then notifies listeners", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const store = storeWith({ read: () => null, write });
    const seen: string[] = [];
    store.addChangeListener(() => seen.push("first"));
    await store.save(store.load());
    expect(write).toHaveBeenCalledOnce();
    expect(seen).toEqual(["first"]);
  });

  it("isolates throwing listeners", async () => {
    const store = storeWith({ read: () => null, write: async () => {} });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      store.addChangeListener(() => {
        throw new Error("listener boom");
      });
      let second = false;
      store.addChangeListener(() => {
        second = true;
      });
      store.notifyChanged();
      expect(second).toBe(true);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
