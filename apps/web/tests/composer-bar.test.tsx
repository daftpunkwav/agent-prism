// @vitest-environment jsdom
/**
 * @file composer bar tests
 * @description Locks the run bar: suggestion lifecycle, attachment chips, and run/stop dispatch.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RunAttachment, TaskTemplate } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { ComposerBar } from "../src/app/arena/ComposerBar.js";

const TEMPLATES = [
  { id: "tpl-alpha", name: "Alpha", question: "Explain gravity", category: "open", suggested_selections: [] },
  { id: "tpl-beta", name: "Beta", question: "Write a haiku about tests", category: "open", suggested_selections: [] },
] as unknown as TaskTemplate[];

function baseProps(overrides?: { running?: boolean; activeSelectionCount?: number; question?: string; attachments?: RunAttachment[] }) {
  return {
    error: null as string | null,
    sessions: {},
    historySeedLabel: null,
    onClearConversation: vi.fn(),
    running: overrides?.running ?? false,
    templates: TEMPLATES,
    onApplyTemplate: vi.fn(),
    question: overrides?.question ?? "",
    onQuestionChange: vi.fn(),
    attachments: overrides?.attachments ?? [],
    onAttachFiles: vi.fn(),
    onRemoveAttachment: vi.fn(),
    activeSelectionCount: overrides?.activeSelectionCount ?? 2,
    onRequestRun: vi.fn(),
    onRequireSelection: vi.fn(),
    onStop: vi.fn(),
  };
}

function renderBar(props = baseProps()) {
  render(
    <I18nProvider initialLocale="en">
      <ComposerBar {...props} />
    </I18nProvider>,
  );
  return props;
}

const en = () => getCatalog("en");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ComposerBar", () => {
  it("shows the error banner as an alert when set", () => {
    renderBar({ ...baseProps(), error: "run exploded" });
    expect(screen.getByRole("alert").textContent).toBe("run exploded");
  });

  it("shows the focused suggestion list and picks one with its template", () => {
    const props = renderBar();
    const input = screen.getByLabelText(en().arena.composer.questionAria);
    fireEvent.focus(input);
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    fireEvent.click(options[0]!);
    // The picked suggestion writes back the question and applies its template.
    expect(props.onQuestionChange).toHaveBeenCalled();
    expect(props.onApplyTemplate).toHaveBeenCalledWith(expect.objectContaining({ category: "open" }));
  });

  it("runs on Enter with selections and demands setup without them", () => {
    const props = renderBar({ ...baseProps(), question: "why is the sky blue" });
    const input = screen.getByLabelText(en().arena.composer.questionAria);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onRequestRun).toHaveBeenCalledOnce();
    cleanup();

    const bare = renderBar({ ...baseProps(), question: "why", activeSelectionCount: 0 });
    fireEvent.keyDown(screen.getByLabelText(en().arena.composer.questionAria), { key: "Enter" });
    expect(bare.onRequireSelection).toHaveBeenCalledOnce();
    expect(bare.onRequestRun).not.toHaveBeenCalled();
  });

  it("flips the run button into a stop button while running", () => {
    const props = renderBar(baseProps({ running: true }));
    const stop = screen.getByRole("button", { name: en().arena.action.stop });
    fireEvent.click(stop);
    expect(props.onStop).toHaveBeenCalledOnce();
    // Input is disabled while a run streams.
    expect((screen.getByLabelText(en().arena.composer.questionAria) as HTMLInputElement).disabled).toBe(true);
  });

  it("renders attachment chips with sizes and remove handoff", () => {
    const props = renderBar(
      baseProps({ attachments: [{ name: "notes.txt", content: "x".repeat(2048) }] as unknown as RunAttachment[] }),
    );
    expect(screen.getByText("notes.txt")).toBeDefined();
    expect(screen.getByText("2.0 KB")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: en().arena.attach.removeAria.replace("{name}", "notes.txt") }));
    expect(props.onRemoveAttachment).toHaveBeenCalledWith("notes.txt");
  });

  it("collects picked files through the hidden file input", () => {
    const props = renderBar();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["abc"], "a.txt")] } });
    expect(props.onAttachFiles).toHaveBeenCalledOnce();
  });
});
