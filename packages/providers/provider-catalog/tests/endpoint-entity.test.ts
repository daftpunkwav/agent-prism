/**
 * @file endpoint entity tests
 * @description Locks update-to-entity mapping: id keeping and generation.
 */

import { describe, expect, it } from "vitest";
import { endpointUpdateToEntity } from "../src/provider-config.js";

const ids = { next: () => "generated" };

describe("endpointUpdateToEntity", () => {
  it("keeps an explicit id", () => {
    const entity = endpointUpdateToEntity({ id: "ep1" }, ids);
    expect(entity.id).toBe("ep1");
  });

  it("generates an id when blank", () => {
    const entity = endpointUpdateToEntity({ id: "  " }, ids);
    expect(entity.id).toBe("generated");
  });
});
