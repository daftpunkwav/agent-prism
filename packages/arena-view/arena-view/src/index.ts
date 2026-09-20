/**
 * @file arena-view package barrel
 * @description Public exports for the arena-view package.
 *
 * Responsibilities:
 * - Re-export event merging, phase grouping, trace alignment, column state, and
 *   answer extraction
 */

export * from "./trace-events.js";
export * from "./phase-groups.js";
export * from "./extract-final-answer.js";
export * from "./answer-compare.js";
export * from "./column-state.js";
