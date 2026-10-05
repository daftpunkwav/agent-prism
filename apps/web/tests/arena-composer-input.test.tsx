// @vitest-environment jsdom
/**
 * @file arena composer input tests
 * @description Locks the Arena composer's input handling: attachments, the
 * question-to-template binding, and switching the comparison dimension.
 *
 * Responsibilities:
 * - Pin attachment validation: byte ceiling, count ceiling, duplicates, unreadable files
 * - Pin the template binding: picking a suggestion binds the auto-judge, and editing the
 *   question drops that binding as soon as the text diverges from the template's text
 * - Pin dimension switching from the setup control: state resets and the URL parameter
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ArenaEvent, ArenaMeta, TaskTemplate } from "@agentprism/client";
import { judgeAnswers, streamArenaRun } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { ArenaClient } from "../src/app/arena/ArenaClient.js";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  fetchArenaMeta: vi.fn(async () => META),
  fetchTemplates: vi.fn(async () => TEMPLATES),
  fetchProvider: vi.fn(async () => PROVIDER),
  streamArenaRun: vi.fn(),
  judgeAnswers: vi.fn(async () => ({})),
  stopArenaColumn: vi.fn(async () => undefined),
}));

const streamMock = vi.mocked(streamArenaRun);
const judgeMock = vi.mocked(judgeAnswers);

const PROVIDER = {
  model: "glm-5.3",
  provider_name: "z.ai",
  temperature: 0.5,
  top_p: 0.9,
  frequency_penalty: 0,
  presence_penalty: 0,
  max_output_tokens: 8192,
  max_input_tokens: 128000,
  context_window: 131072,
  endpoints: [{ id: "ep-1" }],
};

const METRICS = {
  success: true,
  duration_ms: 1200,
  input_tokens: 10,
  output_tokens: 5,
  total_tokens: 15,
  tool_calls: 0,
  steps: 1,
  context_window: 131072,
  max_input_tokens: 128000,
  max_output_tokens: 8192,
  context_usage_pct: 0.1,
  input_usage_pct: 0.1,
};

const META = {
  dimensions: [
    {
      id: "framework",
      label: "Framework",
      options: [
        { value: "native", label: "Native" },
        { value: "langchain", label: "LangChain" },
      ],
    },
    {
      id: "prompt",
      label: "Prompt",
      options: [{ value: "zero_shot", label: "Zero-shot" }],
    },
  ],
  baseline_fields: [],
  baseline_defaults: {},
} as unknown as ArenaMeta;

const TEMPLATE_QUESTION = "Compute (128 + 64) * 2. Reply with the number only.";
const TEMPLATES = [
  {
    id: "arithmetic_mix",
    name: "Mixed arithmetic",
    description: "Multi-step math",
    question: TEMPLATE_QUESTION,
    suggested_dimension: "framework",
    suggested_selections: ["native"],
    judge: { type: "numeric", operator: "==", value: 384 },
    category: "scored",
  },
] as unknown as TaskTemplate[];

const en = () => getCatalog("en").arena;

// jsdom ships no scrollIntoView, and the select popup scrolls its active row into view.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

/** Hand-driven stream double: emit events, then settle. */
let emit: ((event: ArenaEvent) => void) | undefined;
let settle: (() => void) | undefined;
function scriptStream(): void {
  streamMock.mockImplementation(
    (params: Parameters<typeof streamArenaRun>[0]) =>
      new Promise<void>((resolve) => {
        emit = params.onEvent;
        settle = resolve;
      }),
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  emit = undefined;
  settle = undefined;
  window.history.replaceState(null, "", "/arena");
});

async function renderArena(): Promise<void> {
  render(
    <I18nProvider initialLocale="en">
      <ArenaClient />
    </I18nProvider>,
  );
  await screen.findByLabelText(en().composer.questionAria);
}

const questionInput = () => screen.getByLabelText(en().composer.questionAria) as HTMLInputElement;
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

/** Picks files through the hidden input, the path the composer's paperclip uses. */
async function attach(files: File[]): Promise<void> {
  const input = fileInput();
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
  await act(async () => {});
}

const attachmentNames = (): string[] =>
  [...document.querySelectorAll(".composer-attachment-name")].map((node) => node.textContent ?? "");

/** Runs one streamed turn that settles every column with a successful complete. */
async function runToCompletion(answer: string): Promise<void> {
  scriptStream();
  fireEvent.click(screen.getByRole("button", { name: en().action.run }));
  await waitFor(() => expect(streamMock).toHaveBeenCalled());
  await act(async () => {
    emit?.({ type: "thought_delta", pipeline: "Native", content: answer, turn: 1 } as unknown as ArenaEvent);
    emit?.({ type: "complete", pipeline: "Native", metrics: METRICS, turn: 1 } as unknown as ArenaEvent);
    emit?.({ type: "complete", pipeline: "LangChain", metrics: METRICS, turn: 1 } as unknown as ArenaEvent);
  });
  await act(async () => {
    settle?.();
  });
}

describe("ArenaClient composer attachments", () => {
  it("adds a picked file with its byte size and removes it again", async () => {
    await renderArena();
    await attach([new File(["a".repeat(2048)], "notes.md", { type: "text/plain" })]);
    expect(attachmentNames()).toEqual(["notes.md"]);
    expect(document.querySelector(".composer-attachment-size")?.textContent).toBe("2.0 KB");

    fireEvent.click(screen.getByRole("button", { name: en().attach.removeAria.replace("{name}", "notes.md") }));
    expect(attachmentNames()).toEqual([]);
  });

  it("rejects a file over the byte ceiling and keeps the rest of the pick", async () => {
    await renderArena();
    const big = new File(["x"], "big.txt", { type: "text/plain" });
    Object.defineProperty(big, "size", { value: 65 * 1024 });
    await attach([big, new File(["ok"], "small.txt", { type: "text/plain" })]);
    expect(attachmentNames()).toEqual(["small.txt"]);
    expect(screen.getByText(en().attach.tooLarge.replace("{name}", "big.txt"))).toBeTruthy();
  });

  it("caps the list at five files and reports the limit", async () => {
    await renderArena();
    await attach(Array.from({ length: 6 }, (_v, i) => new File(["body"], `file-${i}.txt`, { type: "text/plain" })));
    expect(attachmentNames()).toHaveLength(5);
    expect(screen.getByText(en().attach.tooMany)).toBeTruthy();
  });

  it("ignores a duplicate name", async () => {
    await renderArena();
    await attach([new File(["aaaa"], "dup.txt", { type: "text/plain" })]);
    await attach([new File(["bbbbbbbb"], "dup.txt", { type: "text/plain" })]);
    expect(attachmentNames()).toEqual(["dup.txt"]);
    // The first pick wins: the second file of the same name never replaces it.
    expect(document.querySelector(".composer-attachment-size")?.textContent).toBe("0.0 KB");
  });

  it("skips an unreadable file without failing the rest of the pick", async () => {
    await renderArena();
    const broken = new File(["irrelevant"], "broken.txt", { type: "text/plain" });
    Object.defineProperty(broken, "text", { value: () => Promise.reject(new Error("read failed")) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await attach([broken, new File(["content"], "good.txt", { type: "text/plain" })]);
    expect(attachmentNames()).toEqual(["good.txt"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("accepts a body at the byte ceiling", async () => {
    await renderArena();
    await attach([new File(["y".repeat(64 * 1024)], "at-ceiling.txt", { type: "text/plain" })]);
    expect(attachmentNames()).toEqual(["at-ceiling.txt"]);
    expect(document.querySelector(".composer-attachment-size")?.textContent).toBe("64.0 KB");
  });

  it("drops attachments from the composer after a settled run", async () => {
    await renderArena();
    await attach([new File(["seed"], "seed.txt", { type: "text/plain" })]);
    fireEvent.change(questionInput(), { target: { value: "do the thing" } });
    await runToCompletion("done");
    await waitFor(() => expect(attachmentNames()).toEqual([]));
  });
});

describe("ArenaClient template binding", () => {
  it("binds the template's judge when its suggestion is picked, and drops the binding once the question diverges", async () => {
    await renderArena();
    // The suggestion list opens with random picks; typing filters it to the template.
    fireEvent.focus(questionInput());
    fireEvent.change(questionInput(), { target: { value: "Compute (128" } });
    const option = await screen.findByRole("option", { name: /Mixed arithmetic/ });
    fireEvent.click(option);
    expect(questionInput().value).toBe(TEMPLATE_QUESTION);

    await runToCompletion("384");
    // The bound template drives the auto-judge for the settled answers.
    await waitFor(() => expect(judgeMock).toHaveBeenCalled());
    expect(judgeMock.mock.calls[0]?.[0]).toBe("arithmetic_mix");

    // Editing the question away from the template text drops the binding, so the
    // next settled run is not judged against that template.
    judgeMock.mockClear();
    fireEvent.change(questionInput(), { target: { value: `${TEMPLATE_QUESTION} Also explain.` } });
    await runToCompletion("384");
    await waitFor(() => expect(streamMock).toHaveBeenCalledTimes(2));
    expect(judgeMock).not.toHaveBeenCalled();
  });

  it("keeps the binding when the edited text still matches the template's text apart from spacing", async () => {
    await renderArena();
    fireEvent.focus(questionInput());
    fireEvent.change(questionInput(), { target: { value: "Compute (128" } });
    fireEvent.click(await screen.findByRole("option", { name: /Mixed arithmetic/ }));

    // Re-typing the same text with surrounding whitespace is not a divergence.
    fireEvent.change(questionInput(), { target: { value: `   ${TEMPLATE_QUESTION}   ` } });
    await runToCompletion("384");
    await waitFor(() => expect(judgeMock).toHaveBeenCalled());
    expect(judgeMock.mock.calls[0]?.[0]).toBe("arithmetic_mix");
  });
});

describe("ArenaClient dimension switching", () => {
  it("switches the dimension, resets the stage, and writes the URL parameter", async () => {
    await renderArena();
    expect(window.location.search).toBe("");
    // The setup control is the only dimension switch left in the UI.
    fireEvent.click(screen.getByRole("button", { name: en().setup.dimensionLabel }));
    fireEvent.click(screen.getByRole("option", { name: "Prompt" }));
    await waitFor(() => expect(window.location.search).toContain("dimension=prompt"));
    // The new dimension's options replace the previous dimension's: the label shows
    // in the lane picker and in the column placeholder, while the old dimension's
    // options are gone.
    expect((await screen.findAllByText("Zero-shot")).length).toBeGreaterThan(0);
    expect(screen.queryByText("LangChain")).toBeNull();
  });

  it("ignores a re-selection of the active dimension", async () => {
    await renderArena();
    fireEvent.click(screen.getByRole("button", { name: en().setup.dimensionLabel }));
    fireEvent.click(screen.getByRole("option", { name: "Framework" }));
    await act(async () => {});
    // No switch happened, so no URL parameter and the options stay in place.
    expect(window.location.search).toBe("");
    expect(screen.getAllByText("LangChain").length).toBeGreaterThan(0);
  });
});
