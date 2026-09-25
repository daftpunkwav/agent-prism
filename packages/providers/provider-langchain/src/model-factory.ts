/**
 * @file model-factory
 * @description Chat model construction from provider config.
 *
 * Responsibilities:
 * - Resolve config via explicit overrides, endpoint, then top-level mirror
 * - Map thinking options per API format
 * - Build column bundles (model + runtime) for the Arena
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic, type ChatAnthropicInput } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Callbacks } from "@langchain/core/callbacks/manager";
import type { LlmEndpoint, PipelineConfig, ProviderConfig } from "@agentprism/contracts";
import { ConfigurationError, effectiveThinkingLevel, validateLlmBaseUrl } from "@agentprism/contracts";
import { resolveCredentialReference, resolveDefaultEndpoint } from "@agentprism/provider-catalog";
import { lookupEndpoint, type EndpointCatalog } from "@agentprism/provider-catalog";
import { buildThinkingClientOptions } from "@agentprism/provider-catalog";
import { createResponsesCompatFetch } from "./openai-responses-compat.js";
import { toLlmAdapter } from "./chat-model-adapter.js";

/** Explicit overrides for a single model construction (highest priority). */
export interface ModelOverrides {
  endpointId?: string;
  apiKey?: string;
  baseUrl?: string;
  apiFormat?: string;
  authField?: string;
  temperature?: number;
  model?: string;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  thinkingCapable?: boolean;
  thinkingLevel?: string;
  /** Run-level Anthropic budget_tokens (0/absent = follow the level mapping). */
  thinkingBudget?: number;
}

export interface CreateChatModelOptions {
  provider: ProviderConfig;
  catalog?: EndpointCatalog;
  overrides?: ModelOverrides;
  /** LangChain instance callbacks (e.g. the wire tracer); rides on every call including bound runnables. */
  callbacks?: Callbacks;
  /** Per-call timeout in milliseconds; defaults to LLM_TIMEOUT_MS (settings injects the operator value). */
  timeoutMs?: number;
  /** SDK-level transient-failure retry count; defaults to 2 (settings injects the operator value). */
  maxRetries?: number;
}

/** Both SDKs' timeout fields are in milliseconds; the two branches must share this constant. */
export const LLM_TIMEOUT_MS = 120_000;
/** Default SDK retry count when the caller does not inject one. */
export const LLM_MAX_RETRIES = 2;

/**
 * Constructs a chat model instance. Resolution priority: explicit overrides →
 * specified endpoint → config top-level mirror. A missing API Key, an illegal
 * base_url, or an unknown endpointId throws outright — no silent fallback
 * (running on the wrong model/URL/billing entity is worse than refusing).
 */
export function createChatModel(options: CreateChatModelOptions): BaseChatModel {
  const { provider, catalog, overrides = {} } = options;

  let endpoint: LlmEndpoint | undefined;
  if (overrides.endpointId !== undefined && overrides.endpointId !== "") {
    endpoint = lookupEndpoint(overrides.endpointId, provider, catalog);
    // Fail-fast like a missing API key: running on the wrong model/URL/billing entity is worse than refusing.
    if (endpoint === undefined) {
      throw new ConfigurationError(`Unknown endpoint_id "${overrides.endpointId}"; it may have been deleted or renamed`);
    }
  } else if (overrides.endpointId === undefined) {
    endpoint = overrides.baseUrl === undefined ? resolveDefaultEndpoint(provider) : undefined;
  }

  // Credential references resolve here (the single key-consumption point, also covering
  // connection tests which delegate with an explicit apiKey override); stored values keep
  // their reference form so secrets never persist resolved.
  const apiKey = resolveCredentialReference(overrides.apiKey ?? endpoint?.api_key ?? provider.api_key);
  if (apiKey === "") {
    throw new ConfigurationError("API Key is not configured; set it in Provider settings first");
  }
  const baseUrlRaw = overrides.baseUrl ?? endpoint?.base_url ?? provider.base_url;
  let baseUrl: string;
  try {
    baseUrl = validateLlmBaseUrl(baseUrlRaw);
  } catch {
    // Sanitized fixed copy (never echo the URL: base URLs may embed credentials);
    // without this the sanitizer would expose only the bare type name.
    throw new ConfigurationError("Provider base_url is invalid; check Provider settings");
  }
  const apiFormat = overrides.apiFormat ?? endpoint?.api_format ?? provider.api_format;
  const authField = overrides.authField ?? endpoint?.auth_field ?? provider.auth_field;

  const model = overrides.model && overrides.model !== "" ? overrides.model : (endpoint?.model ?? provider.model);
  const temperature = overrides.temperature ?? provider.temperature;

  const thinkingCapable = overrides.thinkingCapable ?? (endpoint?.thinking_capable ?? false);
  const thinkingLevel =
    overrides.thinkingLevel ?? (endpoint ? effectiveThinkingLevel(endpoint, endpoint.thinking_level) : "off");
  const baseMaxTokens = overrides.maxTokens ?? provider.max_output_tokens;
  // Independent budget selection (anthropic): the run-level budget wins, then
  // the endpoint default pair; without either the level mapping applies.
  const runBudget = overrides.thinkingBudget ?? 0;
  const endpointBudget = endpoint?.thinking_budget_tokens ?? 0;
  const budgetTokens = runBudget > 0 ? runBudget : endpointBudget;
  const budgetOverride =
    budgetTokens > 0
      ? { budgetTokens, maxTokens: endpoint?.thinking_max_tokens ?? 0 }
      : undefined;

  const thinking = buildThinkingClientOptions(apiFormat, thinkingLevel, thinkingCapable, baseMaxTokens, budgetOverride);
  const maxTokens = thinking?.maxTokens ?? baseMaxTokens;
  const timeoutMs = options.timeoutMs ?? LLM_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? LLM_MAX_RETRIES;

  if (apiFormat === "openai_chat" || apiFormat === "openai_responses") {
    return new ChatOpenAI({
      model,
      apiKey,
      temperature,
      maxTokens,
      timeout: timeoutMs,
      maxRetries,
      useResponsesApi: apiFormat === "openai_responses",
      ...(options.callbacks !== undefined ? { callbacks: options.callbacks } : {}),
      configuration: {
        baseURL: baseUrl,
        ...(authField !== "Authorization" && authField !== ""
          ? { defaultHeaders: { [authField]: apiKey } }
          : {}),
        // Vendor Responses payloads (MiniMax: annotations:null on output_text)
        // crash the SDK converter; normalize them at the transport seam.
        ...(apiFormat === "openai_responses" ? { fetch: createResponsesCompatFetch() } : {}),
      },
      ...(overrides.topP !== undefined ? { top_p: overrides.topP } : {}),
      ...(overrides.frequencyPenalty !== undefined ? { frequency_penalty: overrides.frequencyPenalty } : {}),
      ...(overrides.presencePenalty !== undefined ? { presence_penalty: overrides.presencePenalty } : {}),
      ...(thinking?.reasoningEffort !== undefined ? { reasoning_effort: thinking.reasoningEffort } : {}),
    });
  }

  return new ChatAnthropic({
    model,
    apiKey,
    // @langchain/anthropic rejects the request client-side unless temperature is 1 when thinking is enabled (Anthropic spec)
    temperature: thinking?.thinking !== undefined ? 1 : temperature,
    maxTokens,
    maxRetries,
    ...(options.callbacks !== undefined ? { callbacks: options.callbacks } : {}),
    clientOptions: {
      baseURL: baseUrl,
      timeout: timeoutMs,
    },
    // @langchain/anthropic rejects top_p client-side when thinking is enabled, same constraint family as temperature
    ...(overrides.topP !== undefined && thinking?.thinking === undefined ? { topP: overrides.topP } : {}),
    // Vendor thinking modes ("adaptive", …) ride the type field verbatim; the
    // SDK serializes the block untouched and the upstream API validates it.
    ...(thinking?.thinking !== undefined
      ? { thinking: thinking.thinking as ChatAnthropicInput["thinking"] }
      : {}),
  });
}

/** Per-column run model construction result (vendor ChatModel + window metadata). */
export interface ColumnModelBundle {
  model: BaseChatModel;
  contextWindow: number;
  maxInputTokens: number;
}

/** Optional runtime-construction extras (callbacks ride on every model call). */
export interface ColumnRuntimeOptions {
  callbacks?: Callbacks;
  /** Per-call timeout in milliseconds; defaults to LLM_TIMEOUT_MS. */
  timeoutMs?: number;
  /** SDK-level transient-failure retry count; defaults to LLM_MAX_RETRIES. */
  maxRetries?: number;
}

/** Builds a model from column config (override priority matches single-column execution). */
export function createColumnModel(
  deps: { provider: ProviderConfig; catalog?: EndpointCatalog },
  config: PipelineConfig,
  options: ColumnRuntimeOptions = {},
): ColumnModelBundle {
  const provider = deps.provider;
  const endpoint = lookupEndpoint(config.endpoint_id, provider, deps.catalog) ?? resolveDefaultEndpoint(provider);
  if (endpoint?.enabled === false) {
    throw new ConfigurationError(
      `Endpoint "${endpoint.id}" (${endpoint.label || endpoint.model}) is disabled in settings`,
    );
  }
  const model = createChatModel({
    provider,
    catalog: deps.catalog,
    callbacks: options.callbacks,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    overrides: {
      endpointId: config.endpoint_id === "" ? undefined : config.endpoint_id,
      temperature: config.temperature,
      model: config.model_id === "" ? undefined : config.model_id,
      maxTokens: config.max_output_tokens,
      topP: config.top_p,
      frequencyPenalty: config.frequency_penalty,
      presencePenalty: config.presence_penalty,
      thinkingCapable: config.thinking_capable,
      thinkingLevel: config.thinking_level,
      thinkingBudget: config.thinking_budget,
    },
  });
  return {
    model,
    contextWindow: endpoint?.context_window ?? 128_000,
    maxInputTokens: endpoint?.max_input_tokens ?? 120_000,
  };
}

/** Builds a ColumnRuntime: LlmAdapter + opaque llmVendor for LC/LG tool loops. */
export function createColumnRuntime(
  deps: { provider: ProviderConfig; catalog?: EndpointCatalog },
  config: PipelineConfig,
  options: ColumnRuntimeOptions = {},
): import("@agentprism/contracts").ColumnRuntime {
  const bundle = createColumnModel(deps, config, options);
  return {
    llm: toLlmAdapter(bundle.model),
    llmVendor: bundle.model,
    contextWindow: bundle.contextWindow,
    maxInputTokens: bundle.maxInputTokens,
  };
}
