// @vitest-environment jsdom
/**
 * @file TokenStatsPanel tests
 * @description Locks token stats rendering in compact and full variants.
 *
 * Responsibilities:
 * - Pin compact/full copy, caps, and percentage rendering
 * - Pin host-injected labels overriding the neutral defaults
 * - Pin defensive zero fallback for missing percentages
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { TokenStats } from "@agentprism/contracts";
import { TokenStatsPanel } from "../src/TokenStatsPanel.js";

afterEach(() => cleanup());

function testStats(): TokenStats {
  return {
    input_tokens: 120,
    output_tokens: 45,
    total_tokens: 165,
    context_window: 128000,
    max_input_tokens: 120000,
    max_output_tokens: 2048,
    context_usage_pct: 25,
    input_usage_pct: 10,
  };
}

describe("TokenStatsPanel", () => {
  it("compact variant renders short values", () => {
    render(<TokenStatsPanel stats={testStats()} compact />);
    expect(screen.getByText("In 120")).toBeDefined();
    expect(screen.getByText("Out 45")).toBeDefined();
    expect(screen.getByText("Total 165")).toBeDefined();
    expect(screen.getByText("Ctx 25%")).toBeDefined();
  });

  it("full variant renders labels, caps, and shares", () => {
    render(<TokenStatsPanel stats={testStats()} />);
    expect(screen.getByText("Input")).toBeDefined();
    expect(screen.getByText("Cap 120k")).toBeDefined();
    expect(screen.getByText("Window 128k")).toBeDefined();
    expect(screen.getByText("Context share")).toBeDefined();
    expect(screen.getByText("Input share (of max input)")).toBeDefined();
  });

  it("host labels override the defaults", () => {
    render(
      <TokenStatsPanel
        stats={testStats()}
        compact
        labels={{
          compactInput: "Eingabe",
          compactOutput: "Ausgabe",
          compactTotal: "Gesamt",
          compactContext: "Kontext",
          input: "Eingabe",
          output: "Ausgabe",
          total: "Gesamt",
          cap: "Limit",
          window: "Fenster",
          contextShare: "Kontextanteil",
          inputShare: "Eingabeanteil",
        }}
      />,
    );
    expect(screen.getByText("Eingabe 120")).toBeDefined();
    expect(screen.queryByText("In 120")).toBeNull();
  });

  it("missing percentages fall back to zero", () => {
    const stats = {
      ...testStats(),
      context_usage_pct: undefined as unknown as number,
      input_usage_pct: undefined as unknown as number,
    };
    render(<TokenStatsPanel stats={stats} compact />);
    expect(screen.getByText("Ctx 0%")).toBeDefined();
  });
});
