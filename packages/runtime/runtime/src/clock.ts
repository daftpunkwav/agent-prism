/**
 * @file clock
 * @description Wall-clock implementation of the Clock port.
 *
 * Responsibilities:
 * - Provide the system time source injected at the composition root
 *
 * Identity generation lives in id-generator.ts.
 */

import type { Clock } from "@agentprism/contracts";

/** Wall-clock Clock port (production time source; tests inject fakes instead). */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}
