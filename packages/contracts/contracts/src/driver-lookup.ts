/**
 * @file driver-lookup
 * @description Port for looking up agent framework drivers.
 *
 * Responsibilities:
 * - Resolve a framework id to a driver, with reserved-id errors
 *
 * The orchestration layer depends only on this interface, not on a registry.
 */

import type { AgentDriver } from "./agent-driver.js";

/** A registered, runnable framework entry. */
export interface AvailableFramework {
  id: string;
  name: string;
  status: "available";
}

/** A reserved framework entry that is not implemented yet. */
export interface ReservedFramework {
  id: string;
  name: string;
  status: "reserved";
}

/** Driver lookup port: the orchestration layer depends only on this interface. */
export interface DriverLookup {
  get(frameworkId: string): AgentDriver;
  listAvailable(): AvailableFramework[];
  listReserved(): ReservedFramework[];
}

/** Framework driver is not registered. */
export class DriverNotFoundError extends Error {
  readonly frameworkId: string;
  constructor(frameworkId: string) {
    super(`Unregistered framework: ${frameworkId}`);
    this.name = "DriverNotFoundError";
    this.frameworkId = frameworkId;
  }
}

/** Framework driver is reserved but not implemented. */
export class DriverReservedError extends Error {
  readonly frameworkId: string;
  readonly reason: string;
  constructor(frameworkId: string, reason: string) {
    super(`${frameworkId}: ${reason}`);
    this.name = "DriverReservedError";
    this.frameworkId = frameworkId;
    this.reason = reason;
  }
}
