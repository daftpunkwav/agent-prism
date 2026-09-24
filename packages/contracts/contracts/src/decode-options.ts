/**
 * @file decode-options
 * @description Legal decode-parameter options: single source of truth.
 *
 * Responsibilities:
 * - List temperature/top-p/penalty/max-tokens options and field ranges
 *
 * Dimension routing and baseline absorption derive from these lists; the
 * dimensions display tables must stay consistent with them.
 */

export const TEMPERATURE_OPTIONS: readonly number[] = [0, 0.3, 0.7, 1];
export const TOP_P_OPTIONS: readonly number[] = [0.5, 0.8, 0.9, 1];
export const PENALTY_OPTIONS: readonly number[] = [0, 0.5, 1];
export const MAX_OUTPUT_TOKENS_OPTIONS: readonly number[] = [512, 1024, 2048, 4096, 8192, 96000];

/**
 * Unified clamp ranges for numeric baseline/decode editing controls (the single
 * source of truth for the arena/settings editors, the contract schema, and
 * server-side absorption; both the schema min/max and server clamping derive
 * from this table).
 */
export const DECODE_FIELD_RANGES = {
  temperature: { min: 0, max: 2, step: 0.05 },
  top_p: { min: 0, max: 1, step: 0.05 },
  frequency_penalty: { min: -2, max: 2, step: 0.1 },
  presence_penalty: { min: -2, max: 2, step: 0.1 },
  max_output_tokens: { min: 64, max: 384_000, step: 64 },
  // Anthropic budget_tokens override: 0 means "follow the thinking level".
  thinking_budget: { min: 0, max: 1_000_000, step: 1024 },
  // Runtime step budget, not an API-bounded decode parameter: any positive int
  // is legal, and -1 (UNLIMITED_STEPS) means "no step budget at all".
  max_steps: { min: 1, max: 100_000, step: 1 },
} as const;

/**
 * Sentinel for "no step budget" (max_steps only): the agent loop runs until the
 * model stops calling tools or the run is aborted. Chosen because -1 is outside
 * every legal range above, survives JSON round-trips, and keeps PipelineConfig
 * fields plain numbers.
 */
export const UNLIMITED_STEPS = -1;

/** Whether a max_steps value means "unlimited" (the -1 sentinel). */
export function isUnlimitedSteps(value: number): boolean {
  return value === UNLIMITED_STEPS;
}
