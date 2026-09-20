/**
 * @file persistence package barrel
 * @description Public exports for the persistence package.
 *
 * Responsibilities:
 * - Re-export the JSON file port and atomic store helpers
 */

export * from "./json-store.js";
export * from "./json-file.js";
export * from "./append-file.js";
