/**
 * @file tool-batch
 * @description Re-export of the shared driver tool-batch executor.
 *
 * Responsibilities:
 * - Keep native imports stable while the implementation lives in driver-registry
 *
 * The executor is backend-neutral; see driver-registry/tool-batch.
 */

export { collectPriorToolNames, executeToolCalls } from "@agentprism/driver-registry";
