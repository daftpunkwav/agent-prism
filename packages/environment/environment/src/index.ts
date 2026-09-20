/**
 * @file environment package barrel
 * @description Public exports for the environment package.
 *
 * Responsibilities:
 * - Re-export scoped filesystem access and shell-free process execution
 * - Re-export the OS write-sandbox spawn transform and its setup-failure parsing
 */

export * from "./scoped-filesystem.js";
export * from "./process-runner.js";
export * from "./sandbox-launcher.js";
