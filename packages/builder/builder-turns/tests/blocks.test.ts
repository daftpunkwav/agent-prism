/**
 * @file blocks tests
 * @description Locks the block-palette projection: builtin capability slots plus
 * one generic `custom:<id>` block per registered custom dimension.
 */

import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@agentprism/contracts";
import { buildBuilderCatalog, type BuilderCustomBlock } from "../src/blocks.js";

function tool(name: string): ToolDefinition {
  return { name, description: "", mutatesWorkspace: false } as unknown as ToolDefinition;
}

const probe: BuilderCustomBlock = {
  id: "blocks_probe",
  label: "Blocks probe",
  subtitle: "Probe axis",
  default: "high",
  options: [
    { value: "low", label: "Low", description: "" },
    { value: "high", label: "High", description: "Keeps more" },
  ],
};

describe("buildBuilderCatalog", () => {
  it("appends one custom block per registered dimension, after the builtin slots", () => {
    const catalog = buildBuilderCatalog({
      frameworks: () => [
        { id: "native", name: "Native", status: "available" },
        { id: "claude_agent_sdk", name: "Claude", status: "available" },
      ],
      endpoints: () => [],
      tools: () => [tool("write"), tool("read")],
      customDimensions: () => [probe],
    });

    expect(catalog.frameworks).toEqual([
      { id: "native", name: "Native", status: "available", reason: "", required_api_format: "" },
      { id: "claude_agent_sdk", name: "Claude", status: "available", reason: "", required_api_format: "anthropic_messages" },
    ]);
    expect(catalog.tools.map((entry) => entry.name)).toEqual(["read", "write"]);
    const builtin = catalog.capabilities.filter((entry) => !entry.block.startsWith("custom:"));
    // Builtin slots keep empty copy: the web titles them from its own i18n catalogs.
    expect(builtin.every((entry) => entry.label === "" && entry.default === "")).toBe(true);

    const custom = catalog.capabilities.at(-1);
    // The block id is the prefix plus the dimension id, so the web can render any
    // registered dimension generically and write composition.custom[id].
    expect(custom?.block).toBe("custom:blocks_probe");
    expect(custom?.label).toBe("Blocks probe");
    expect(custom?.default).toBe("high");
    expect(custom?.options).toEqual(probe.options);
  });

  it("copies the option rows instead of handing out the registered descriptor's", () => {
    const catalog = buildBuilderCatalog({
      frameworks: () => [],
      endpoints: () => [],
      tools: () => [],
      customDimensions: () => [probe],
    });
    const option = catalog.capabilities.at(-1)?.options[0];
    if (option === undefined) throw new Error("custom block missing");
    option.label = "mutated";
    // Descriptors are process-wide registered objects: a mutated payload must not
    // rewrite the palette (or the run's option table) for every later request.
    expect(probe.options[0]?.label).toBe("Low");
  });
});
