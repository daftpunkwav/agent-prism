/**
 * @file policy-registry
 * @description Registry of ContextPolicy implementations keyed by strategy id.
 *
 * Responsibilities:
 * - Resolve strategies by id; unknown ids fail closed
 */

import type {
  ContextPolicy,
  ContextPolicyInput,
  ContextPolicyRegistry,
  ContextStrategy,
  LlmMessage,
} from "@agentprism/contracts";
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

/** Creates a registry with sliding/summary/vector/hybrid/tool_tail/token_budget policies. */
export function createBuiltinContextPolicyRegistry(): MapContextPolicyRegistry {
  const registry = new MapContextPolicyRegistry();
  for (const id of ["sliding", "summary", "vector", "hybrid", "tool_tail", "token_budget"] as const) {
    registry.register(new StrategyPolicy(id));
  }
  return registry;
}
