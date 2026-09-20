/**
 * @file arena service meta tests
 * @description Locks getMeta: dimensions, sync failures, lazy runner singleton.
 */

import { describe, expect, it, vi } from "vitest";
import { ArenaService, SessionService } from "@agentprism/application";
import { mockAnswerJudge, mockRouter, mockRunner, mockSessions } from "./arena-service-fixtures.js";

describe("ArenaService.getMeta contract", () => {
  it("returns metadata including all dimensions", async () => {
    const router = mockRouter();
    const runner = mockRunner();
    const service = new ArenaService({
      router: router as any,
      runnerFactory: async () => runner as any,
      answerJudge: mockAnswerJudge(),
      sessions: new SessionService({ store: mockSessions() }),
    });

    const meta = await service.getMeta();

    expect(meta.dimensions.length).toBeGreaterThan(0);
    expect(meta.dimensions[0]).toHaveProperty("id");
    expect(meta.dimensions[0]).toHaveProperty("label");
    expect(meta.dimensions[0]).toHaveProperty("subtitle");
    expect(meta.dimensions[0]).toHaveProperty("options");
    expect(meta.dimensions[0]).toHaveProperty("min_select", 1);
    expect(meta.frameworks).toEqual([{ id: "native", name: "Native" }]);
    expect(meta.model_compare_ready).toBe(true);
    expect(router.ensureModelSynced).toHaveBeenCalledOnce();
  });

  it("Provider sync failure does not block metadata return", async () => {
    const router = mockRouter({
      ensureModelSynced: vi.fn().mockImplementation(() => {
        throw new Error("provider corrupted");
      }),
    });
    const runner = mockRunner();
    const service = new ArenaService({
      router: router as any,
      runnerFactory: async () => runner as any,
      answerJudge: mockAnswerJudge(),
      sessions: new SessionService({ store: mockSessions() }),
    });

    const meta = await service.getMeta();
    expect(meta.dimensions.length).toBeGreaterThan(0);
  });

  it("getMeta triggers on-demand sync on every call (no-op when already synced)", async () => {
    const router = mockRouter();
    const runner = mockRunner();
    const service = new ArenaService({
      router: router as any,
      runnerFactory: async () => runner as any,
      answerJudge: mockAnswerJudge(),
      sessions: new SessionService({ store: mockSessions() }),
    });

    await service.getMeta();
    await service.getMeta();
    expect(router.ensureModelSynced).toHaveBeenCalledTimes(2);
    expect("syncModelOptionsFromProvider" in router).toBe(false);
  });

  it("Runner factory is called only once (lazy singleton)", async () => {
    const factory = vi.fn().mockResolvedValue(mockRunner());
    const service = new ArenaService({
      router: mockRouter() as any,
      runnerFactory: factory,
      answerJudge: mockAnswerJudge(),
      sessions: new SessionService({ store: mockSessions() }),
    });

    await service.getMeta();
    await service.getMeta();
    expect(factory).toHaveBeenCalledOnce();
  });
});

