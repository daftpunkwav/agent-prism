/**
 * @file tuning
 * @description Per-run context strategy budgets (contracts single source).
 *
 * Responsibilities:
 * - Re-export the ContextTuning interface owned by contracts
 *
 * The interface lives in contracts so custom-dimension hooks (which return
 * budget patches) are typed without a harness dependency; this module keeps the
 * harness export path stable for existing consumers.
 */

export type { ContextTuning } from "@agentprism/contracts";
