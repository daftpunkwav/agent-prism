/**
 * @file provider-service
 * @description Provider settings use cases: read, save, and connectivity test.
 *
 * Responsibilities:
 * - Project stored config to the public view with secrets excluded
 * - Save with API-key inheritance and validation
 * - Run connectivity tests against configured endpoints
 */

import type {
  ConnectionTestResult,
  IdGenerator,
  LlmEndpointUpdateInput,
  ProviderCommand,
  ProviderConfigPublic,
  ProviderConfigRepository,
  ProviderConfigUpdate,
} from "@agentprism/contracts";
import { ProviderConfigUpdateSchema } from "@agentprism/contracts";
import { AppError, firstIssueMessage } from "./errors.js";

export interface ProviderServiceDeps {
  providerStore: ProviderConfigRepository;
  providerCommand: ProviderCommand;
  idGenerator: IdGenerator;
}

/** Legacy flat-protocol fields: save migration and connection-test legacy share this one enumeration; new fields only change here. models is a top-level derived field, not part of the endpoint schema. */
function legacyFlatFields(body: ProviderConfigUpdate): LlmEndpointUpdateInput & { models: string[] } {
  return {
    provider_name: body.provider_name,
    api_key: body.api_key,
    base_url: body.base_url,
    use_full_url: body.use_full_url,
    api_format: body.api_format,
    auth_field: body.auth_field,
    model: body.model,
    models: body.models,
    context_window: body.context_window,
    max_input_tokens: body.max_input_tokens,
    max_output_tokens: body.max_output_tokens,
  };
}

/** Provider settings use cases: read the public view, save (key inheritance + validation), connectivity test. */
export class ProviderService {
  private readonly deps: ProviderServiceDeps;

  constructor(deps: ProviderServiceDeps) {
    this.deps = deps;
  }

  /** Returns the public provider view (stored keys masked, never raw). */
  getProvider(): ProviderConfigPublic {
    return this.publicView();
  }

  /** Saves the config: empty keys inherit stored values by endpoint id/connection fingerprint; illegal structures throw 400. */
  async saveProvider(body: ProviderConfigUpdate): Promise<ProviderConfigPublic> {
    const current = this.deps.providerStore.load();
    const command = this.deps.providerCommand;

    const ids = this.deps.idGenerator;
    let endpoints = body.endpoints.map((endpoint) => command.endpointUpdateToEntity(endpoint, ids));
    if (endpoints.length === 0) {
      // Legacy flat protocol: top-level connection fields + models[] derivation
      const legacy = command.parseConfig(legacyFlatFields(body), this.deps.idGenerator);
      endpoints = legacy.endpoints;
    }

    const merged = command.mergeEndpointKeys(endpoints, current.endpoints);

    let config;
    try {
      config = command.parseConfig(
        {
          notes: body.notes,
          website_url: body.website_url,
          endpoints: merged,
          default_endpoint_id: body.default_endpoint_id,
          temperature: body.temperature,
          top_p: body.top_p,
          frequency_penalty: body.frequency_penalty,
          presence_penalty: body.presence_penalty,
          max_output_tokens: body.max_output_tokens,
        },
        this.deps.idGenerator,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Config validation failed";
      throw AppError.badRequest(message);
    }

    try {
      await this.deps.providerStore.save(config);
    } catch (error) {
      console.warn(`[provider] Failed to persist config: ${error instanceof Error ? error.message : String(error)}`);
      throw AppError.internal("Failed to save config");
    }
    return this.publicView();
  }

  /**
   * Tests connectivity without saving anything.
   *
   * @param body Draft config, or null to test the stored config as-is.
   * @returns Per-endpoint connection results.
   */
  async testProvider(body: ProviderConfigUpdate | null): Promise<ConnectionTestResult> {
    const provider = this.deps.providerStore.load();
    const target =
      body === null
        ? null
        : {
            testEndpointId: body.test_endpoint_id === "" ? undefined : body.test_endpoint_id,
            endpoints: body.endpoints.length > 0 ? body.endpoints : undefined,
            legacy: body.endpoints.length === 0 ? legacyFlatFields(body) : undefined,
          };
    return this.deps.providerCommand.testConnection(provider, target);
  }

  /** Parses the update request body (the transport passes raw JSON); schema failure maps to 422. */
  static parseUpdate(raw: unknown): ProviderConfigUpdate {
    const parsed = ProviderConfigUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(422, firstIssueMessage(parsed.error));
    }
    return parsed.data;
  }

  private publicView(): ProviderConfigPublic {
    return this.deps.providerCommand.toPublic(this.deps.providerStore.load());
  }
}

