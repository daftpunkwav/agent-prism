/**
 * @file arena-dimensions package barrel
 * @description Public exports for the arena-dimensions package.
 *
 * Responsibilities:
 * - Re-export dimension routing, baselines, capability options, and templates
 * - Re-export the custom-dimension registry entry points (owned by harness), so
 *   domain packages register and inspect dimensions without a harness dependency
 *
 * Execution lives in arena-runner; this leaf never imports it.
 */

export * from "./baseline.js";
export * from "./baseline-fields.js";
export * from "./field-values.js";
export * from "./router.js";
export * from "./provider-dimension-sync.js";
export * from "./task-templates.js";
export * from "./capability-options.js";
export * from "./custom-dimension-rows.js";
export { customDimension, listCustomDimensions, registerCustomDimensions } from "@agentprism/harness";
export type { CustomDimension } from "@agentprism/contracts";
