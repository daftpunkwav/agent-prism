/**
 * @file builder client fixtures
 * @description Shared test doubles for the BuilderClient suites: the block
 *              catalog, a full composition, a session detail, and the
 *              I18n-wrapped render helper.
 *
 * Type-only imports: the suites mock "@agentprism/client" at runtime, so this
 * module must not depend on it beyond erased types.
 */

import { render, type RenderResult } from "@testing-library/react";
import type { BuilderCatalog, BuilderComposition } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { BuilderClient } from "../src/app/builder/BuilderClient.js";

export const BUILDER_CATALOG = {
  capabilities: [
    { block: "reasoning", options: [{ value: "react", label: "react", description: "ReAct" }] },
  ],
  endpoints: [],
  frameworks: [{ id: "native", name: "Native", status: "available", reason: "" }],
  tools: [{ name: "read", description: "read", mutates_workspace: false }],
} as unknown as BuilderCatalog;

export const BUILDER_COMPOSITION = {
  framework: "native",
  endpoint_id: "",
  tools: [],
  model_id: "",
  thinking_level: "off",
  context: "full",
  prompt_profile: "zero_shot",
  reasoning: "react",
  harness: "std",
  memory: "off",
  mcp_policy: "off",
  skill_policy: "off",
  orchestration: "single",
  system_prompt: "",
  temperature: 0.7,
  top_p: 1,
  max_output_tokens: 8192,
  max_steps: 24,
  frequency_penalty: 0,
  presence_penalty: 0,
} as unknown as BuilderComposition;

export const BUILDER_DETAIL = {
  session: { id: "s1", name: "My agent", composition: BUILDER_COMPOSITION, history: [], workspace: "" },
  records: [],
};

/** Renders BuilderClient with the English catalog, the suites' common shell. */
export function renderBuilderClient(): RenderResult {
  return render(
    <I18nProvider initialLocale="en">
      <BuilderClient />
    </I18nProvider>,
  );
}
