/**
 * @file id-generator
 * @description Random identity generation (12 hex chars) implementing the IdGenerator port.
 *
 * Responsibilities:
 * - Produce random run/execution ids (48-bit, not globally unique; sufficient for run-scoped ids)
 *
 * Time source lives in clock.ts.
 */

import { randomUUID } from "node:crypto";
import type { IdGenerator } from "@agentprism/contracts";

/** Random 12-hex-char IdGenerator port (run-scoped ids, not global UUIDs). */
export class RandomIdGenerator implements IdGenerator {
  next(): string {
    return randomUUID().replaceAll("-", "").slice(0, 12);
  }
}
