/**
 * @file arena service judge tests
 * @description Locks judge: unknown-template rejection.
 */

import { describe, expect, it } from "vitest";
import { ArenaService, SessionService } from "@agentprism/application";
import { mockAnswerJudge, mockRouter, mockRunner, mockSessions } from "./arena-service-fixtures.js";

describe("ArenaService.judge contract", () => {
  it("unknown template throws notFound", () => {
    const service = new ArenaService({
      router: mockRouter() as any,
      runnerFactory: async () => mockRunner() as any,
      answerJudge: mockAnswerJudge(),
      sessions: new SessionService({ store: mockSessions() }),
    });

    expect(() => service.judge("nonexistent", {})).toThrow();
  });
});
