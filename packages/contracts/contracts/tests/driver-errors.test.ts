/**
 * @file driver errors tests
 * @description Locks driver-lookup error contracts: names, messages, fields.
 */

import { describe, expect, it } from "vitest";
import { DriverNotFoundError, DriverReservedError } from "@agentprism/contracts";

describe("DriverNotFoundError", () => {
  it("carries the framework id in message and field", () => {
    const error = new DriverNotFoundError("autogen");
    expect(error.name).toBe("DriverNotFoundError");
    expect(error.frameworkId).toBe("autogen");
    expect(error.message).toContain("autogen");
  });
});

describe("DriverReservedError", () => {
  it("carries the framework id and reason", () => {
    const error = new DriverReservedError("crewai", "not implemented yet");
    expect(error.name).toBe("DriverReservedError");
    expect(error.frameworkId).toBe("crewai");
    expect(error.reason).toBe("not implemented yet");
    expect(error.message).toContain("crewai");
  });
});
