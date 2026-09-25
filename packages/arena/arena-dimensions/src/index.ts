/**
 * @file arena-dimensions package barrel
 * @description Public exports for the arena-dimensions package.
 *
 * Responsibilities:
 * - Re-export dimension routing, baselines, capability options, and templates
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
