/**
 * @file ports
 * @description Infrastructure ports: Clock and IdGenerator (pure interfaces).
 *
 * Responsibilities:
 * - Define the side-effectful primitives injected at the composition root
 *
 * No implementations, no IO. Business code must not call Date.now(),
 * performance.now(), or randomUUID() directly.
 */

/** Time source port (millisecond timestamps). */
export interface Clock {
  now(): number;
}

/** Identity generation port (12-char hex, matching the existing resource id format). */
export interface IdGenerator {
  next(): string;
}
