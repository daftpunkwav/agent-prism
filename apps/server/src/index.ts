/**
 * @file server barrel
 * @description Public exports for the server host.
 *
 * Responsibilities:
 * - Re-export assembly, route mounting, driver loading, server startup,
 *   and lifecycle helpers
 */

export * from "./assemble.js";
export * from "./mount-routes.js";
export * from "./load-drivers.js";
export * from "./server.js";
export * from "./lifecycle.js";
export * from "./portcheck.js";
