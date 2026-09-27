// @vitest-environment jsdom
/**
 * @file block board tests
 * @description Locks the composition board: chips, tool toggles, numeric fields, and hot-swap gating.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BuilderCatalog, BuilderComposition } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { BlockBoard } from "../src/app/builder/BlockBoard.js";

const CATALOG = {
  capabilities: [
    {
      block: "reasoning",
      label: "",
      default: "",
      options: [
        { value: "react", label: "react", description: "ReAct loop" },
        { value: "tot", label: "tot", description: "Tree of thoughts" },
        // No catalog key: a value the catalogs do not translate (the dynamic-option
        // case) must fall back to the label the server sent.
        { value: "probe_mode", label: "Probe mode", description: "Untranslated option" },
      ],
    },
    // Custom-dimension blocks arrive from the server as `custom:<id>` with their
    // own label/default/options; the board renders them generically.
    {
      block: "custom:summary_budget",
      label: "Summary budget",
      default: "5000",
      options: [
        { value: "2000", label: "2k tokens", description: "Small digest" },
        { value: "5000", label: "5k tokens", description: "Medium digest" },
      ],
    },
  ],
  endpoints: [{ id: "ep-1", name: "Main endpoint" }],
  frameworks: [
    { id: "native", name: "Native", status: "available", reason: "" },
    { id: "crewai", name: "CrewAI", status: "reserved", reason: "not wired" },
  ],
  tools: [
    { name: "read", description: "read files", mutates_workspace: false },
    { name: "write", description: "write files", mutates_workspace: true },
  ],
} as unknown as BuilderCatalog;

const COMPOSITION = {
  framework: "native",
  endpoint_id: "",
  tools: ["read"],
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

afterEach(cleanup);

function renderBoard(overrides?: { dirty?: boolean; swapBlocked?: boolean }) {
  const onChange = vi.fn();
  const onApplySwap = vi.fn();
  const onRestoreDefaults = vi.fn();
  render(
    <I18nProvider initialLocale="en">
      <BlockBoard
        catalog={CATALOG}
        composition={COMPOSITION}
        onChange={onChange}
        onApplySwap={onApplySwap}
        onRestoreDefaults={onRestoreDefaults}
        dirty={overrides?.dirty ?? true}
        swapBlocked={overrides?.swapBlocked ?? false}
      />
    </I18nProvider>,
  );
  return { onChange, onApplySwap, onRestoreDefaults };
}

const en = () => getCatalog("en").builder;

describe("BlockBoard", () => {
  it("renders the assembled strip and available/reserved framework chips", () => {
    renderBoard();
    expect(screen.getByText(en().boardTitle)).toBeDefined();
    const native = screen.getByRole("button", { name: "Native" });
    expect(native.getAttribute("data-selected")).toBe("true");
    const reserved = screen.getByRole("button", { name: "CrewAI" });
    expect((reserved as HTMLButtonElement).disabled).toBe(true);
    expect(reserved.getAttribute("title")).toContain("not wired");
  });

  it("hands framework and model patches upward", () => {
    const { onChange } = renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Native" }));
    // Same framework reselect still emits a draft patch with the same value.
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ framework: "native" }));
    fireEvent.change(screen.getByPlaceholderText(en().modelPlaceholder), { target: { value: "glm-5.3" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ model_id: "glm-5.3" }));
  });

  it("toggles tool chips on and off and clears all via the no-tools chip", () => {
    const { onChange } = renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "write" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tools: ["read", "write"] }));
    fireEvent.click(screen.getByRole("button", { name: en().noTools }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tools: [] }));
  });

  it("gates the hot-swap button on dirty state and running turns", () => {
    const { onApplySwap } = renderBoard({ dirty: true, swapBlocked: false });
    const apply = screen.getByRole("button", { name: new RegExp(en().applySwap) });
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(apply);
    expect(onApplySwap).toHaveBeenCalledOnce();
    cleanup();

    const blocked = renderBoard({ dirty: true, swapBlocked: true });
    expect((screen.getByRole("button", { name: new RegExp(en().applySwap) }) as HTMLButtonElement).disabled).toBe(true);
    expect(blocked.onApplySwap).not.toHaveBeenCalled();
    cleanup();

    renderBoard({ dirty: false, swapBlocked: false });
    expect((screen.getByRole("button", { name: new RegExp(en().applySwap) }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("commits numeric input on blur and keeps the previous value for blank input", () => {
    const { onChange } = renderBoard();
    const temperature = screen.getByLabelText(en().temperature) as HTMLInputElement;
    fireEvent.focus(temperature);
    fireEvent.change(temperature, { target: { value: "1.5" } });
    fireEvent.blur(temperature);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ temperature: 1.5 }));
    fireEvent.focus(temperature);
    fireEvent.change(temperature, { target: { value: "" } });
    fireEvent.blur(temperature);
    // Blank input reverts silently: no extra commit, the value stays 1.5.
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("shows the server label for an option no catalog key covers", () => {
    renderBoard();
    // The dynamic-option case: a chip whose value the catalogs do not translate
    // renders the catalog payload's label, never the resolveMessage marker.
    expect(screen.getByRole("button", { name: "Probe mode" })).toBeDefined();
    expect(screen.queryByText(/⟦/)).toBeNull();
  });

  it("renders custom-dimension blocks, highlighting the server default and writing the choice into composition.custom", () => {
    const { onChange } = renderBoard();
    expect(screen.getByText("Summary budget")).toBeDefined();
    // Unset shows the block's effective default, the same value the run applies.
    expect(screen.getByRole("button", { name: "5k tokens" }).getAttribute("data-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "2k tokens" }).getAttribute("data-selected")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "2k tokens" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ custom: { summary_budget: "2000" } }));
  });

  it("reports restore-default clicks", () => {
    const { onRestoreDefaults } = renderBoard();
    const restore = screen.getByRole("button", { name: en().restoreDefaults });
    fireEvent.click(restore);
    expect(onRestoreDefaults).toHaveBeenCalledOnce();
  });
});
