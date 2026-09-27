/**
 * @file policy-registry
 * @description Registry of ContextPolicy implementations keyed by strategy id.
 *
 * Responsibilities:
 * - Resolve builtin strategies by id; unknown ids fail closed
 *
 * Custom comparison dimensions are a separate axis (see ../dimensions): they do
 * not become context strategies, so the strategy set here is exactly the
 * contracts enum and every id the pipeline dispatches is resolvable.
 */

import type {
  ContextPolicy,
  ContextPolicyInput,
  ContextPolicyRegistry,
  ContextStrategy,
  LlmMessage,
} from "@agentprism/contracts";
import { ContextStrategySchema } from "@agentprism/contracts";
import { UnknownPromptConfigError } from "../prompt/errors.js";
import { applyContextPipeline } from "./pipeline.js";

class StrategyPolicy implements ContextPolicy {
  constructor(readonly id: ContextStrategy) {}

  // ContextPolicyInput (not a redeclared subset): new required input fields must surface
  // here at compile time instead of silently diverging from the port.
  apply(input: ContextPolicyInput): LlmMessage[] {
    const retrieve = input.retrieveSnippets;
    return applyContextPipeline(input.messages, this.id, {
      retrieveSnippets:
        retrieve === undefined
          ? undefined
          : (query) => {
              const value = retrieve(query);
              if (value !== null && typeof value === "object" && "then" in value) {
                throw new Error("ContextPolicy.apply expects a synchronous retrieveSnippets");
              }
              return value as string;
            },
    });
  }
}

/** In-memory context policy registry. */
export class MapContextPolicyRegistry implements ContextPolicyRegistry {
  private readonly policies = new Map<ContextStrategy, ContextPolicy>();

  register(policy: ContextPolicy): void {
    this.policies.set(policy.id, policy);
  }

  get(strategy: ContextStrategy): ContextPolicy {
    const found = this.policies.get(strategy);
    if (found === undefined) {
      throw new UnknownPromptConfigError("context", strategy);
    }
    return found;
  }

  listIds(): string[] {
    return [...this.policies.keys()].sort();
  }
}

/** Creates a registry with every builtin policy (same set the pipeline dispatches on). */
export function createBuiltinContextPolicyRegistry(): MapContextPolicyRegistry {
  const registry = new MapContextPolicyRegistry();
  for (const id of ContextStrategySchema.options) {
    registry.register(new StrategyPolicy(id));
  }
  return registry;
}
