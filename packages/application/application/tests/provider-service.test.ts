/**
 * @file provider service tests
 * @description Locks provider use cases: public view, update parsing, save, connection test.
 */

import { describe, expect, it, vi } from "vitest";
import type { ProviderCommand, ProviderConfigRepository } from "@agentprism/contracts";
import { ProviderConfigUpdateSchema } from "@agentprism/contracts";
import { AppError, ProviderService } from "@agentprism/application";

function stubCommand() {
  return {
    toPublic: vi.fn().mockReturnValue({ provider_name: "public" }),
    mergeEndpointKeys: vi.fn((incoming: unknown[]) => incoming),
    endpointUpdateToEntity: vi.fn((update: unknown) => update),
    parseConfig: vi.fn((raw: unknown) => raw),
    testConnection: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
  } as unknown as ProviderCommand;
}

function stubRepository() {
  return {
    load: vi.fn().mockReturnValue({ endpoints: [] }),
    save: vi.fn().mockResolvedValue(undefined),
  } as unknown as ProviderConfigRepository;
}

function setup() {
  const command = stubCommand();
  const store = stubRepository();
  const ids = { next: () => "id1" };
  return {
    command,
    store,
    service: new ProviderService({ providerStore: store, providerCommand: command, idGenerator: ids }),
  };
}

describe("ProviderService.getProvider", () => {
  it("projects the stored config to the public view", () => {
    const { service } = setup();
    expect(service.getProvider()).toEqual({ provider_name: "public" });
  });
});

describe("ProviderService.parseUpdate", () => {
  it("parses valid payloads", () => {
    const raw = ProviderConfigUpdateSchema.parse({});
    expect(ProviderService.parseUpdate(raw)).toBeDefined();
  });

  it("maps schema failures to 422", () => {
    try {
      ProviderService.parseUpdate({ temperature: "hot" });
      expect.unreachable("expected a 422 AppError");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(422);
    }
  });
});

describe("ProviderService.testProvider", () => {
  it("probes the stored provider when body is null", async () => {
    const { service, command } = setup();
    await service.testProvider(null);
    expect(command.testConnection).toHaveBeenCalledWith({ endpoints: [] }, null);
  });

  it("clears empty test endpoint ids", async () => {
    const { service, command } = setup();
    const body = ProviderConfigUpdateSchema.parse({ test_endpoint_id: "" });
    await service.testProvider(body);
    expect(command.testConnection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ testEndpointId: undefined }),
    );
  });
});

describe("ProviderService.saveProvider", () => {
  it("persists parsed config and returns the public view", async () => {
    const { service, store } = setup();
    const body = ProviderConfigUpdateSchema.parse({ endpoints: [{ id: "ep1" }] });
    const view = await service.saveProvider(body);
    expect(store.save).toHaveBeenCalledOnce();
    expect(view).toEqual({ provider_name: "public" });
  });

  it("maps persistence failures to 500", async () => {
    const { service, store } = setup();
    (store.save as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("disk gone"));
    const body = ProviderConfigUpdateSchema.parse({ endpoints: [{ id: "ep1" }] });
    try {
      await service.saveProvider(body);
      expect.unreachable("expected a 500 AppError");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(500);
    }
  });
});
