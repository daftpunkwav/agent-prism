/**
 * @file provider
 * @description Provider API contracts: defaults, public/update schemas, test result.
 *
 * Responsibilities:
 * - Own default provider/model/URL constants (single source)
 * - Define endpoint and config public/update schema pairs
 * - Define the connection-test result shape
 */

import { z } from "zod";
import { DECODE_FIELD_RANGES } from "./decode-options.js";
import { validateLlmBaseUrl, validateWebsiteUrl } from "./url-validation.js";

/**
 * Default provider constants (system-wide single source of truth).
 * Brand/vendor defaults live here; contracts/config/providers/arena/dimensions must
 * all reference these — hardcoding brand defaults inside business packages is forbidden.
 */
export const DEFAULT_PROVIDER_NAME = "StepFun";
export const DEFAULT_MODEL_ID = "step-3.7-flash";
export const DEFAULT_LLM_BASE_URL = "https://api.stepfun.com/step_plan";
export const DEFAULT_WEBSITE_URL = "https://platform.stepfun.com/step-plan";

/**
 * Endpoint collection ceiling: the update schema, the legacy models derivation, and the
 * providers-side truncation all share this bound (one project reaches 16 workspaces, but
 * endpoints per provider stay small; larger fleets belong in multiple configs).
 */
export const MAX_ENDPOINTS = 12;

/** Public endpoint view (API keys only return a sanitized preview). */
export const LlmEndpointPublicSchema = z.object({
  id: z.string(),
  label: z.string().default(""),
  provider_name: z.string().default(""),
  api_key_set: z.boolean().default(false),
  api_key_preview: z.string().default(""),
  base_url: z.string(),
  use_full_url: z.boolean().default(true),
  api_format: z.string(),
  auth_field: z.string(),
  model: z.string(),
  context_window: z.number().int().default(128_000),
  max_input_tokens: z.number().int().default(120_000),
  max_output_tokens: z.number().int().default(96000),
  website_url: z.string().default(""),
  thinking_capable: z.boolean().default(false),
  thinking_level: z.string().default("off"),
  thinking_levels: z.array(z.string()).default([]),
  image_input: z.boolean().default(false),
  video_input: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type LlmEndpointPublic = z.infer<typeof LlmEndpointPublicSchema>;

/** Endpoint update item (element of endpoints in PUT /api/settings/provider). */
export const LlmEndpointUpdateSchema = z.object({
  id: z.string().max(64).default(""),
  label: z.string().max(100).default(""),
  provider_name: z.string().max(100).default(""),
  api_key: z.string().max(4096).default(""),
  base_url: z
    .string()
    .max(500)
    .default("")
    .refine((value) => {
      if (value === "") return true;
      try {
        validateLlmBaseUrl(value);
        return true;
      } catch {
        return false;
      }
    }, "base_url is invalid"),
  use_full_url: z.boolean().default(true),
  api_format: z.string().default("anthropic_messages"),
  auth_field: z.string().max(100).default("ANTHROPIC_AUTH_TOKEN"),
  model: z.string().max(200).default(DEFAULT_MODEL_ID),
  context_window: z.number().int().min(1024).max(10_000_000).default(128_000),
  max_input_tokens: z.number().int().min(256).max(10_000_000).default(120_000),
  max_output_tokens: z.number().int().min(64).max(128_000).default(96000),
  website_url: z
    .string()
    .max(500)
    .default("")
    .refine((value) => {
      try {
        validateWebsiteUrl(value);
        return true;
      } catch {
        return false;
      }
    }, "website_url is invalid"),
  thinking_capable: z.boolean().default(false),
  thinking_level: z.string().trim().max(32).default("off"),
  thinking_levels: z.array(z.string().trim().min(1).max(32)).max(16).default([]),
  image_input: z.boolean().default(false),
  video_input: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type LlmEndpointUpdate = z.infer<typeof LlmEndpointUpdateSchema>;

/** Public provider config view. */
export const ProviderConfigPublicSchema = z.object({
  notes: z.string(),
  website_url: z.string(),
  endpoints: z.array(LlmEndpointPublicSchema).default([]),
  default_endpoint_id: z.string().default(""),
  temperature: z.number(),
  top_p: z.number().default(1.0),
  frequency_penalty: z.number().default(0.0),
  presence_penalty: z.number().default(0.0),
  max_output_tokens: z.number().int(),
  provider_name: z.string(),
  api_key_set: z.boolean(),
  api_key_preview: z.string(),
  base_url: z.string(),
  use_full_url: z.boolean(),
  api_format: z.string(),
  auth_field: z.string(),
  model: z.string(),
  models: z.array(z.string()).default([]),
  context_window: z.number().int(),
  max_input_tokens: z.number().int(),
});
export type ProviderConfigPublic = z.infer<typeof ProviderConfigPublicSchema>;

/** Provider config update request. */
export const ProviderConfigUpdateSchema = z.object({
  notes: z.string().max(500).default(""),
  website_url: z.string().max(500).default(""),
  endpoints: z.array(LlmEndpointUpdateSchema).max(MAX_ENDPOINTS).default([]),
  default_endpoint_id: z.string().max(64).default(""),
  temperature: z.number().min(DECODE_FIELD_RANGES.temperature.min).max(DECODE_FIELD_RANGES.temperature.max).default(0.0),
  top_p: z.number().min(DECODE_FIELD_RANGES.top_p.min).max(DECODE_FIELD_RANGES.top_p.max).default(1.0),
  frequency_penalty: z.number().min(DECODE_FIELD_RANGES.frequency_penalty.min).max(DECODE_FIELD_RANGES.frequency_penalty.max).default(0.0),
  presence_penalty: z.number().min(DECODE_FIELD_RANGES.presence_penalty.min).max(DECODE_FIELD_RANGES.presence_penalty.max).default(0.0),
  max_output_tokens: z.number().int().min(DECODE_FIELD_RANGES.max_output_tokens.min).max(DECODE_FIELD_RANGES.max_output_tokens.max).default(96000),
  provider_name: z.string().max(100).default(DEFAULT_PROVIDER_NAME),
  api_key: z.string().max(4096).default(""),
  base_url: z.string().max(500).default(""),
  use_full_url: z.boolean().default(true),
  api_format: z.string().default("anthropic_messages"),
  auth_field: z.string().max(100).default("ANTHROPIC_AUTH_TOKEN"),
  model: z.string().max(200).default(DEFAULT_MODEL_ID),
  // Length is a schema constraint (not a transform-time throw): in zod 4 a raw throw inside
  // .transform escapes even safeParse as an uncaught exception (HTTP 500), never a 422 issue.
  models: z
    .array(z.string().max(200, "Model id is too long"))
    .max(MAX_ENDPOINTS)
    .default([])
    .transform((items) => {
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const item of items) {
        const trimmed = item.trim();
        if (trimmed === "" || seen.has(trimmed)) continue;
        seen.add(trimmed);
        cleaned.push(trimmed);
      }
      return cleaned;
    }),
  context_window: z.number().int().min(1024).max(10_000_000).default(128_000),
  max_input_tokens: z.number().int().min(256).max(10_000_000).default(120_000),
  test_endpoint_id: z.string().max(64).default(""),
});
export type ProviderConfigUpdate = z.infer<typeof ProviderConfigUpdateSchema>;
/** Update payload submittable by the frontend (schema input side: fields may be omitted; omitted fields take their defaults). */
export type ProviderConfigUpdateInput = z.input<typeof ProviderConfigUpdateSchema>;
export type LlmEndpointUpdateInput = z.input<typeof LlmEndpointUpdateSchema>;

/** Endpoint connectivity test result. */
export const ConnectionTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  model: z.string().default(""),
});
export type ConnectionTestResult = z.infer<typeof ConnectionTestResultSchema>;
