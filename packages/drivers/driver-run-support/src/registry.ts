/**
 * @file registry
 * @description Framework driver registry with reserved-entry handling.
 *
 * Responsibilities:
 * - Look up drivers by framework id
 *
 * Backends register themselves here; the composition root owns the builtin
 * loader list (see builtin-registration for the best-effort helper).
 */

import type { AgentDriver, DriverLookup } from "@agentprism/contracts";
import { DriverNotFoundError, DriverReservedError } from "@agentprism/contracts";

interface ReservedEntry {
  name: string;
  reason: string;
}

/** Framework driver registry: throws DriverReservedError when a reserved entry is requested without a registered driver. */
export class FrameworkDriverRegistry implements DriverLookup {
  private readonly drivers = new Map<string, AgentDriver>();
  // Placeholders for framework ids the Arena knows about but whose backend may be
  // missing at runtime (the autogen/crewai bridges need a Python interpreter with
  // the package). A successful registration deletes its entry, so these only
  // surface when that backend could not register.
  private readonly reserved = new Map<string, ReservedEntry>([
    ["autogen", { name: "AutoGen", reason: "AutoGen backend unavailable in this runtime" }],
    ["crewai", { name: "CrewAI", reason: "CrewAI backend unavailable in this runtime" }],
  ]);

  register(driver: AgentDriver): void {
    // frameworkId keys the map and displayName is served by listAvailable: reject blank
    // identities at registration, not at lookup/render time.
    if (
      typeof driver.run !== "function" ||
      typeof driver.frameworkId !== "string" ||
      driver.frameworkId === "" ||
      typeof driver.displayName !== "string" ||
      driver.displayName === ""
    ) {
      throw new TypeError("Driver must implement the AgentDriver contract (run, frameworkId, displayName)");
    }
    this.drivers.set(driver.frameworkId, driver);
    this.reserved.delete(driver.frameworkId);
  }

  get(frameworkId: string): AgentDriver {
    const reserved = this.reserved.get(frameworkId);
    if (reserved !== undefined && !this.drivers.has(frameworkId)) {
      throw new DriverReservedError(frameworkId, reserved.reason);
    }
    const driver = this.drivers.get(frameworkId);
    if (driver === undefined) {
      throw new DriverNotFoundError(frameworkId);
    }
    return driver;
  }

  listAvailable(): Array<{ id: string; name: string; status: "available" }> {
    return [...this.drivers.values()].map((driver) => ({
      id: driver.frameworkId,
      name: driver.displayName,
      status: "available",
    }));
  }

  listReserved(): Array<{ id: string; name: string; status: "reserved" }> {
    return [...this.reserved.entries()].map(([id, entry]) => ({
      id,
      name: entry.name,
      status: "reserved",
    }));
  }
}

