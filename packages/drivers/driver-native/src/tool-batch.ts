/**
 * @file tool-batch
 * @description Re-export of the shared driver tool-batch executor.
 *
 * Responsibilities:
 * - Keep native imports stable while the implementation lives in driver-run-support
 *
 * The executor is backend-neutral; see driver-run-support/tool-batch.
 */

export { collectPriorToolNames, executeToolCalls } from "@agentprism/driver-run-support";
