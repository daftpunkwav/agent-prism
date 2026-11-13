/**
 * @file context-mentions package barrel
 * @description Public exports for the `@file` mention package.
 *
 * Responsibilities:
 * - Re-export mention grammar, workspace resolution, candidate search, and fence escaping
 */

export * from "./fence.js";
export * from "./grammar.js";
export * from "./resolve.js";
export * from "./search.js";
