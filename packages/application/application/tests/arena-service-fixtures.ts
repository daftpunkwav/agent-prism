/**
 * @file arena service fixtures
 * @description Shared ArenaService doubles: router, runner, and answer judge.
 *
 * Responsibilities:
 * - Build mock collaborators for the ArenaService contract tests
 *
 * Support module, not a test: picked up by no runner (no .test suffix).
 */

import { vi, type Mock } from "vitest";
import { InMemorySessionStore } from "@agentprism/session";

/** Loose router double: members the contract tests observe or override. */
export interface MockRouter {
  ensureModelSynced: Mock;
  listDimensionOptions: Mock;
  dimensionCatalog: {
    baselineDefaultsPayload: Mock;
    fieldLabel: (id: string) => string;
    fieldSubtitle: (id: string) => string;
  };
  listBaselineFields: Mock;
  modelCompareReady: Mock;
}

/** Loose runner double: slots and streams the run tests reprogram. */
export interface MockRunner {
  registry: {
    listAvailable: Mock;
    listReserved: Mock;
  };
  acquireSlot: Mock;
  streamParallel: Mock;
}

/** Loose answer-judge double. */
export interface MockAnswerJudge {
  judgeAnswers: Mock;
}


export function mockRouter(overrides: Record<string, any> = {}): MockRouter {
  return {
    ensureModelSynced: vi.fn(),
    listDimensionOptions: vi.fn().mockReturnValue([
      { field: "reasoning", value: "react", label: "ReAct" },
    ]),
    dimensionCatalog: {
      baselineDefaultsPayload: vi.fn().mockReturnValue({ temperature: "0" }),
      fieldLabel: (id: string) => id,
      fieldSubtitle: (_id: string) => "",
    },
    listBaselineFields: vi.fn().mockReturnValue([]),
    modelCompareReady: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

export function mockRunner(): MockRunner {
  return {
    registry: {
      listAvailable: vi.fn().mockReturnValue([{ id: "native", name: "Native" }]),
      listReserved: vi.fn().mockReturnValue([]),
    },
    acquireSlot: vi.fn().mockResolvedValue(() => {}),
    streamParallel: vi.fn(),
  };
}

export function mockAnswerJudge(): MockAnswerJudge {
  return { judgeAnswers: vi.fn().mockReturnValue({}) };
}


/** Ephemeral session ledger: deterministic ids and clock for run-lifecycle assertions. */
export function mockSessions(): InMemorySessionStore {
  let seq = 0;
  return new InMemorySessionStore({
    idGenerator: { next: () => `ses-test-${++seq}` },
    clock: { now: () => 1700000000000 },
  });
}
