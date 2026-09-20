/**
 * @file builder-service package barrel
 * @description Public exports for the builder-service package.
 *
 * Responsibilities:
 * - Re-export the builder service, its session store, and the trace store
 *
 * Turn execution lives in builder-turns; the service orchestrates it.
 */

export * from "./builder-service.js";
export * from "./session-store.js";
export * from "./trace-store.js";
// Domain error owned by builder-turns; re-exported here because the service
// surface (and its consumers) raise and match on it.
export { BuilderError } from "@agentprism/builder-turns";
