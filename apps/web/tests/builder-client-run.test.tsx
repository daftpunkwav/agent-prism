// @vitest-environment jsdom
/**
 * @file builder client run tests
 * @description Drives the Builder page orchestration: session create, streamed turn, hot-swap, and rename.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BuilderCatalog, BuilderComposition } from "@agentprism/client";
import {
  createBuilderSession,
  fetchBuilderCatalog,
  fetchBuilderSessionDetail,
  fetchBuilderSessions,
  patchBuilderComposition,
  streamBuilderChat,
} from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { BuilderClient } from "../src/app/builder/BuilderClient.js";

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  fetchBuilderCatalog: vi.fn(async () => CATALOG),
  fetchBuilderSessions: vi.fn(async () => SESSIONS),
  createBuilderSession: vi.fn(async () => ({ id: "s1" })),
  fetchBuilderSessionDetail: vi.fn(async () => DETAIL),
  patchBuilderComposition: vi.fn(async (_id: string, patch: { composition?: BuilderComposition }) => ({
    composition: patch.composition ?? COMPOSITION,
  })),
  streamBuilderChat: vi.fn(),
}));

const streamMock = vi.mocked(streamBuilderChat);

const CATALOG = {
  capabilities: [
    { block: "reasoning", options: [{ value: "react", label: "react", description: "ReAct" }] },
  ],
  endpoints: [],
  frameworks: [{ id: "native", name: "Native", status: "available", reason: "" }],
  tools: [{ name: "read", description: "read", mutates_workspace: false }],
} as unknown as BuilderCatalog;

const COMPOSITION = {
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

const SESSIONS = [{ id: "s1", name: "My agent", running: false, turn_count: 0, workspace: "" }] as never[];

const DETAIL = {
  session: { id: "s1", name: "My agent", composition: COMPOSITION, history: [], workspace: "" },
  records: [],
};

const en = () => getCatalog("en").builder;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderBuilder() {
  return render(
    <I18nProvider initialLocale="en">
      <BuilderClient />
    </I18nProvider>,
  );
}

describe("BuilderClient orchestration", () => {
  it("creates a session and loads its composition into the board", async () => {
    renderBuilder();
    fireEvent.click(await screen.findByText(en().newAgent));
    await waitFor(() => expect(createBuilderSession).toHaveBeenCalledOnce());
    await waitFor(() => expect(fetchBuilderSessionDetail).toHaveBeenCalledWith("s1"));
    // The board mounts once catalog + composition are both present.
    expect(await screen.findByText(en().boardTitle)).toBeDefined();
  });

  it("streams a turn: bubbles land in the chat and the workspace is adopted", async () => {
    streamMock.mockImplementation(
      (params: { onChunk: (chunk: never) => void }) =>
        new Promise<void>((resolve) => {
          void act(async () => {
            params.onChunk({
              stream: "event",
              event: { type: "thought", content: "working on it", turn: 1, step: 1 },
            } as never);
            params.onChunk({ stream: "turn", turn: { answer: "All done", workspace: "ws-1" } } as never);
          });
          resolve();
        }),
    );
    renderBuilder();
    fireEvent.click(await screen.findByText(en().newAgent));
    const composer = await screen.findByPlaceholderText(en().chatPlaceholder);
    fireEvent.change(composer, { target: { value: "hi there" } });
    fireEvent.click(screen.getByRole("button", { name: en().send }));
    expect(streamMock).toHaveBeenCalledOnce();
    expect(await screen.findByText("hi there")).toBeDefined();
    expect(screen.getByText("All done")).toBeDefined();
  });

  it("patches the composition through the hot-swap after an edit marks it dirty", async () => {
    renderBuilder();
    fireEvent.click(await screen.findByText(en().newAgent));
    fireEvent.click(await screen.findByRole("button", { name: "read" }));
    const apply = await screen.findByRole("button", { name: new RegExp(en().applySwap) });
    fireEvent.click(apply);
    await waitFor(() => expect(patchBuilderComposition).toHaveBeenCalledWith("s1", expect.objectContaining({ composition: expect.anything() })));
  });

  it("renames a session through the inline editor", async () => {
    renderBuilder();
    fireEvent.click(await screen.findByText(en().newAgent));
    fireEvent.click(await screen.findByRole("button", { name: en().renameAria }));
    const input = await screen.findByLabelText(en().renameAria);
    fireEvent.change(input, { target: { value: "Renamed agent" } });
    fireEvent.click(screen.getByRole("button", { name: en().renameConfirm }));
    await waitFor(() => expect(patchBuilderComposition).toHaveBeenCalledWith("s1", { name: "Renamed agent" }));
  });
});
