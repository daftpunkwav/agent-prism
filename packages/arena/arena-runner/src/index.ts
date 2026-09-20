/**
 * @file arena-runner package barrel
 * @description Public exports for the arena-runner package.
 *
 * Responsibilities:
 * - Re-export the parallel multi-column runner (the column factory port
 *   lives in contracts as ColumnRuntimeFactory)
 */

export * from "./runner.js";
export * from "./column-logs.js";
