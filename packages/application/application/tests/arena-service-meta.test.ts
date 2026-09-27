/**
 * @file arena service meta tests
 * @description Locks getMeta: dimensions, custom axes, sync failures, lazy runner singleton.
 */

import { describe, expect, it, vi } from "vitest";
import { ArenaService, SessionService } from "@agentprism/application";
import { registerCustomDimensions } from "@agentprism/arena-dimensions";
import { mockAnswerJudge, mockRouter, mockRunner, mockSessions } from "./arena-service-fixtures.js";

/** Registered custom axis: /meta must surface its own descriptor copy, not a catalog entry. */
registerCustomDimensions([
  {
    id: "meta_probe",
    label: "Meta probe",
    subtitle: "Probe axis",
    options: [
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ],
    default: "low",
  },
]);

function makeService(router: ReturnType<typeof mockRouter>): ArenaService {
  const runner = mockRunner();
  return new ArenaService({
    router: router as any,
    runnerFactory: async () => runner as any,
    answerJudge: mockAnswerJudge(),
    sessions: new SessionService({ store: mockSessions() }),
  });
}

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

  it("surfaces a registered custom axis with its descriptor label and subtitle", async () => {
    const meta = await makeService(mockRouter()).getMeta();
    const row = meta.dimensions.find((dimension) => dimension.id === "meta_probe");
    // The static dimension catalog has no entry for a package-contributed axis;
    // the descriptor copy travels on the row instead.
    expect(row?.label).toBe("Meta probe");
    expect(row?.subtitle).toBe("Probe axis");
    expect(row?.options.length).toBeGreaterThan(0);
  });

  it("drops a custom axis whose options were never synced", async () => {
    // An axis with no selectable values is not comparable: advertising it would
    // hand the panel a dimension every run request then rejects.
    const router = mockRouter({
      listDimensionOptions: vi.fn((id: string) =>
        id === "meta_probe" ? [] : [{ field: "reasoning", value: "react", label: "ReAct" }],
      ),
    });
    const meta = await makeService(router).getMeta();
    expect(meta.dimensions.some((dimension) => dimension.id === "meta_probe")).toBe(false);
    expect(meta.dimensions.some((dimension) => dimension.id === "framework")).toBe(true);
  });
});

