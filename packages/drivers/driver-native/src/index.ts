/**
 * @file driver-native package barrel
 * @description Public exports for the driver-native package.
 *
 * Responsibilities:
 * - Re-export the in-process native driver (sole public identity)
 *
 * Turn/tool-batch helpers stay internal: they are reached only through the
 * driver and the leaf's own relative-path tests, never across packages.
 */

export * from "./native-driver.js";
