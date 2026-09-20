/**
 * @file http-runtime package barrel
 * @description Public exports for the http-runtime package.
 *
 * Responsibilities:
 * - Re-export the HTTP shell and the shared route plumbing
 *
 * Domain routes live in the route-* leaves; the composition root mounts them.
 */

export * from "./http-app.js";
export * from "./route-plumbing.js";
