// @vitest-environment jsdom
/**
 * @file arena client run tests
 * @description Drives the Arena page orchestration: run flow, attachment cleanup, ask window, stop, and tab panes.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ArenaEvent, ArenaMeta } from "@agentprism/client";
import {
  answerArenaQuestion,
  streamArenaRun,
} from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { ArenaClient } from "../src/app/arena/ArenaClient.js";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  fetchArenaMeta: vi.fn(async () => META),
  fetchTemplates: vi.fn(async () => []),
  fetchProvider: vi.fn(async () => PROVIDER),
  streamArenaRun: vi.fn(),
  stopArenaColumn: vi.fn(async () => undefined),
  answerArenaQuestion: vi.fn(async () => true),
}));

const streamMock = vi.mocked(streamArenaRun);
const answerMock = vi.mocked(answerArenaQuestion);

type StreamParams = Parameters<typeof streamArenaRun>[0];
let emit: ((event: ArenaEvent) => void) | undefined;
let settle: (() => void) | undefined;

/** Installs a hand-driven stream double: emit events, then settle the SSE. */
function scriptStream() {
  streamMock.mockImplementation(
    (params: StreamParams) =>
      new Promise<void>((resolve, reject) => {
        emit = params.onEvent;
        settle = resolve;
        params.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })),
        );
      }),
  );
}

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
  ],
  baseline_fields: [],
  baseline_defaults: {},
} as unknown as ArenaMeta;

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
  input_tokens: 600,
  output_tokens: 300,
  total_tokens: 900,
  context_window: 131072,
  max_input_tokens: 120000,
  max_output_tokens: 8192,
  context_usage_pct: 0.7,
  input_usage_pct: 0.5,
  tool_calls: 1,
  steps: 2,
};

const en = () => getCatalog("en").arena;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderArena() {
  return render(
    <I18nProvider initialLocale="en">
      <ArenaClient />
    </I18nProvider>,
  );
}

async function renderAndType(question: string) {
  renderArena();
  const input = (await screen.findByLabelText(en().composer.questionAria)) as HTMLInputElement;
  fireEvent.change(input, { target: { value: question } });
  return input;
}

describe("ArenaClient run orchestration", () => {
  it("runs both columns to completion, clears attachments, and unlocks the report/diff tabs", async () => {
    scriptStream();
    await renderAndType("why two answers");
    // Seed one attachment; a settled run must drop it from the composer.
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["seed"], "seed.txt")] } });
    expect(await screen.findByText("seed.txt")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: en().action.run }));
    await waitFor(() => expect(streamMock).toHaveBeenCalledOnce());
    const params = streamMock.mock.calls[0]![0]!;
    expect(params.question).toBe("why two answers");
    expect(params.selections).toEqual(["native", "langchain"]);
    expect(params.attachments).toEqual([{ name: "seed.txt", content: "seed" }]);
    // The composer flips into its running state.
    expect((screen.getByLabelText(en().composer.questionAria) as HTMLInputElement).disabled).toBe(true);

    act(() => {
      emit?.({ type: "token_update", pipeline: "Native", token_stats: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, workspace: "ws-native" } as unknown as ArenaEvent);
      emit?.({ type: "complete", pipeline: "Native", metrics: METRICS } as unknown as ArenaEvent);
      emit?.({ type: "complete", pipeline: "LangChain", metrics: { ...METRICS, duration_ms: 2000 } } as unknown as ArenaEvent);
      emit?.({ type: "report", pipeline: "Native", content: JSON.stringify({ question: "why two answers" }) } as unknown as ArenaEvent);
    });
    await act(async () => {
      settle?.();
    });

    // Both columns settled with metrics; the attachment was consumed by the run.
    await waitFor(() => expect(screen.getAllByText(/OK · 1200ms|OK · 2000ms/).length).toBe(2));
    await waitFor(() => expect(screen.queryByText("seed.txt")).toBeNull());

    // Report tab unlocks and shows the comparison plus the project-save card.
    // The tab's badge appends a count to its accessible name, hence the regex.
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(en().tab.report) }));
    // The heading echoes the tab label (now at least twice: button + heading).
    expect((await screen.findAllByText(en().report.title)).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(en().project.title)).toBeDefined();

    // Diff tab unlocks on an all-successful run.
    fireEvent.click(screen.getByRole("tab", { name: en().tab.diff }));
    await waitFor(() => expect(screen.getAllByText(en().tab.diff).length).toBeGreaterThanOrEqual(2));
  });

  it("stops a running turn and returns the composer to idle", async () => {
    scriptStream();
    await renderAndType("long running");
    fireEvent.click(screen.getByRole("button", { name: en().action.run }));
    await waitFor(() => expect(streamMock).toHaveBeenCalledOnce());
    const stop = await screen.findByRole("button", { name: en().action.stop });
    fireEvent.click(stop);
    await waitFor(() => {
      expect((screen.getByLabelText(en().composer.questionAria) as HTMLInputElement).disabled).toBe(false);
    });
  });

  it("surfaces an error when the stream ends before every column settles", async () => {
    scriptStream();
    const input = await renderAndType("connection drops");
    fireEvent.click(screen.getByRole("button", { name: en().action.run }));
    await waitFor(() => expect(streamMock).toHaveBeenCalledOnce());
    // Only the first column settles; the SSE body then ends normally (the
    // connection dropped mid-run without a transport error).
    act(() => {
      emit?.({ type: "complete", pipeline: "Native", metrics: METRICS } as unknown as ArenaEvent);
    });
    await act(async () => {
      settle?.();
    });

    // The disconnect is surfaced instead of the run ending silently, the composer
    // unlocks, and the question stays in the box (the turn is not committed).
    await waitFor(() => expect(screen.getByText(en().stream.disconnected)).toBeDefined());
    expect((screen.getByLabelText(en().composer.questionAria) as HTMLInputElement).disabled).toBe(false);
    expect((input as HTMLInputElement).value).toBe("connection drops");
  });

  it("pops an inline ask window inside its column and answers it", async () => {
    scriptStream();
    await renderAndType("need input");
    fireEvent.click(screen.getByRole("button", { name: en().action.run }));
    await waitFor(() => expect(streamMock).toHaveBeenCalledOnce());

    act(() => {
      emit?.({
        type: "action",
        pipeline: "Native",
        agentId: "agent-1",
        tool: "ask_user",
        args: { questions: [{ id: "q1", header: "Confirm", question: "Proceed?", options: ["yes"] }] },
      } as unknown as ArenaEvent);
    });
    expect(screen.getByRole("dialog", { name: getCatalog("en").common.askTitle })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "yes" }));
    await waitFor(() => expect(answerMock).toHaveBeenCalledWith("agent-1", "q1", "yes"));

    // The observation clears the batch; the run can then be stopped cleanly.
    act(() => {
      emit?.({ type: "observation", pipeline: "Native", agentId: "agent-1" } as unknown as ArenaEvent);
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: getCatalog("en").common.askTitle })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: en().action.stop }));
  });
});
