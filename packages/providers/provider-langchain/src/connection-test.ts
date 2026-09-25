/**
 * @file connection-test
 * @description Endpoint connectivity testing via minimal model invocation.
 *
 * Responsibilities:
 * - Resolve the target endpoint from explicit payloads or stored config
 * - Perform a minimal model call and report the result
 * - Report redacted failure details (type + message, secrets masked)
 */

import type { ConnectionTestResult, ConnectionTestTarget, IdGenerator, LlmEndpoint, ProviderConfig } from "@agentprism/contracts";
import { ConfigurationError } from "@agentprism/contracts";
import { HumanMessage } from "@langchain/core/messages";
import { createChatModel } from "./model-factory.js";
import type { EndpointCatalog } from "@agentprism/provider-catalog";
import { endpointUpdateToEntity } from "@agentprism/provider-catalog";

export type { ConnectionTestTarget };

function extractSnippet(content: unknown): string {
  if (typeof content === "string") return content.slice(0, 80);
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block !== null && typeof block === "object") {
        const record = block as Record<string, unknown>;
        if (record.type === "text" && typeof record.text === "string") {
          return record.text.slice(0, 80);
        }
      }
    }
    for (const block of content) {
      if (block !== null && typeof block === "object") {
        const record = block as Record<string, unknown>;
        if ((record.type === "thinking" || record.type === "reasoning") && typeof record.thinking === "string") {
          return record.thinking.slice(0, 80);
        }
      }
    }
  }
  return "";
}

/** Failure detail ceiling: SDK messages can embed response bodies. */
const PROBE_ERROR_MAX_CHARS = 300;

/**
 * Redacts secrets from a probe failure message. The endpoint key never
 * appears verbatim (SDKs may echo auth headers or request URLs), and URL
 * userinfo (`user:password@`) is masked as a whole — the host stays visible
 * so the failure remains diagnosable.
 */
function redactProbeSecrets(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret !== undefined && secret !== "") out = out.split(secret).join("<redacted>");
  }
  return out.replace(/:\/\/[^/\s@]+@/g, "://<credentials>@");
}

/**
 * Probe failure detail: error type + redacted message. The global sanitizer
 * deliberately exposes only the type name (a bare "Error" cannot be
 * diagnosed), but a connection test targets the operator's own endpoint, so
 * the redacted message is safe to surface here.
 */
function describeProbeError(error: unknown, secrets: Array<string | undefined>): string {
  if (error instanceof ConfigurationError) return error.message;
  const name = error instanceof Error ? error.name : "Error";
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const message = redactProbeSecrets(raw, secrets).slice(0, PROBE_ERROR_MAX_CHARS).trim();
  return message === "" ? name : `${name}: ${message}`;
}

/**
 * Endpoint connectivity test.
 * Selection order: no target → default endpoint; id+endpoints → match within the set;
 * id only → stored endpoint; endpoints only → the first one; otherwise legacy flat construction.
 */
export async function testProviderConnection(
  deps: { provider: ProviderConfig; catalog?: EndpointCatalog; idGenerator: IdGenerator },
  target: ConnectionTestTarget | null,
): Promise<ConnectionTestResult> {
  const { provider, catalog } = deps;
  let endpoint: LlmEndpoint | undefined;

  const providedEndpoints = target?.endpoints ?? [];
  if (target === null || (target.testEndpointId === undefined && providedEndpoints.length === 0)) {
    endpoint = provider.endpoints.find((ep) => ep.id === provider.default_endpoint_id) ?? provider.endpoints[0];
  } else if (target.testEndpointId !== undefined && target.testEndpointId !== "" && providedEndpoints.length > 0) {
    endpoint = providedEndpoints
      .map((item) => endpointUpdateToEntity(item, deps.idGenerator))
      .find((ep) => ep.id === target.testEndpointId);
    if (endpoint === undefined) {
      return { ok: false, message: "No endpoint found to test", model: "" };
    }
  } else if (target.testEndpointId !== undefined && target.testEndpointId !== "") {
    endpoint = provider.endpoints.find((ep) => ep.id === target.testEndpointId);
  } else if (providedEndpoints.length > 0) {
    const first = providedEndpoints[0];
    endpoint = first !== undefined ? endpointUpdateToEntity(first, deps.idGenerator) : undefined;
  } else if (target.legacy !== undefined) {
    endpoint = endpointUpdateToEntity(target.legacy, deps.idGenerator);
  }

  if (endpoint === undefined) {
    return { ok: false, message: "No endpoint found to test", model: "" };
  }
  // BYOK: the form keeps the key input empty once a key is stored, so an
  // empty payload key falls back to the stored endpoint key before failing.
  if (endpoint.api_key === "" && endpoint.id !== "") {
    const id = endpoint.id;
    const stored = provider.endpoints.find((ep) => ep.id === id);
    if (stored?.api_key) endpoint = { ...endpoint, api_key: stored.api_key };
  }
  if (endpoint.api_key === "") {
    return { ok: false, message: "Please provide an API Key first", model: endpoint.model };
  }

  try {
    const model = createChatModel({
      provider,
      catalog,
      overrides: {
        endpointId: undefined,
        apiKey: endpoint.api_key,
        baseUrl: endpoint.base_url,
        apiFormat: endpoint.api_format,
        authField: endpoint.auth_field,
        model: endpoint.model,
        maxTokens: 32,
        temperature: 0,
        thinkingCapable: false,
        thinkingLevel: "off",
      },
    });
    const response = await model.invoke([new HumanMessage("ping")]);
    const snippet = extractSnippet(response.content);
    return { ok: true, message: `Connection succeeded: ${snippet || "ok"}`, model: endpoint.model };
  } catch (error) {
    return { ok: false, message: `Connection failed: ${describeProbeError(error, [endpoint.api_key])}`, model: endpoint.model };
  }
}
