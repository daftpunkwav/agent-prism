// @vitest-environment jsdom
/**
 * @file builder composition persistence tests
 * @description Locks the remembered composition: new sessions start from the
 *              stored preference, and restore-default clears it and resets the
 *              draft to factory defaults.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createBuilderSession,
  fetchBuilderCatalog,
  fetchBuilderSessionDetail,
  fetchBuilderSessions,
} from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { BuilderClient } from "../src/app/builder/BuilderClient.js";

const FACTORY = {
  framework: "native",
  endpoint_id: "",
  model_id: "",
  temperature: 0,
  top_p: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
  max_output_tokens: 64000,
  thinking_level: "off",
  tools: ["read", "write"],
  context: "sliding",
  prompt_profile: "zero_shot",
  reasoning: "react",
  harness: "bare",
  max_steps: 200,
  system_prompt: "",
  mcp_policy: "off",
  skill_policy: "on_demand",
  orchestration: "direct",
  memory: "none",
  history_mode: "minimal",
  approval_mode: "auto",
  sandbox_mode: "off",
};

const CATALOG = {
  capabilities: [
    { block: "reasoning", options: [{ value: "react", label: "react", description: "ReAct loop" }] },
  ],
  endpoints: [{ id: "ep-1", name: "Main endpoint" }],
  frameworks: [{ id: "native", name: "Native", status: "available", reason: "" }],
  tools: [{ name: "read", description: "read files", mutates_workspace: false }],
} as never;

const LAST_USED = { ...FACTORY, temperature: 0.9, framework: "langchain" };

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  fetchBuilderCatalog: vi.fn(async () => CATALOG),
  fetchBuilderSessions: vi.fn(async () => []),
  createBuilderSession: vi.fn(async () => ({
    id: "s1",
    name: "Agent",
    created_at: 0,
    updated_at: 0,
    composition: { ...LAST_USED },
    history: [],
    running: false,
    turn_count: 0,
    workspace: "",
  })),
  fetchBuilderSessionDetail: vi.fn(async () => ({
    session: {
      id: "s1",
      name: "Agent",
      created_at: 0,
      updated_at: 0,
      composition: { ...LAST_USED },
      history: [],
      running: false,
      turn_count: 0,
      workspace: "",
    },
    records: [],
  })),
}));

const createMock = vi.mocked(createBuilderSession);
const detailMock = vi.mocked(fetchBuilderSessionDetail);

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

function renderBuilder() {
  return render(
    <I18nProvider initialLocale="en">
      <BuilderClient />
    </I18nProvider>,
  );
}

describe("builder composition persistence", () => {
  it("prefills newly created sessions with the remembered composition", async () => {
    window.localStorage.setItem("agentprism.builder.composition", JSON.stringify(LAST_USED));
    renderBuilder();
    fireEvent.click(await screen.findByText(getCatalog("en").builder.newAgent));
    await waitFor(() => expect(createMock).toHaveBeenCalledOnce());
    expect(createMock).toHaveBeenCalledWith({ name: "", composition: LAST_USED });
  });

  it("create falls back to factory defaults when no preference is stored", async () => {
    renderBuilder();
    fireEvent.click(await screen.findByText(getCatalog("en").builder.newAgent));
    await waitFor(() => expect(createMock).toHaveBeenCalledOnce());
    expect(createMock).toHaveBeenCalledWith({ name: "", composition: {} });
  });

  it("restore-default clears the stored preference and resets the draft", async () => {
    window.localStorage.setItem("agentprism.builder.composition", JSON.stringify(LAST_USED));
    renderBuilder();
    fireEvent.click(await screen.findByText(getCatalog("en").builder.newAgent));
    await waitFor(() => expect(detailMock).toHaveBeenCalledOnce());
    // Session view loaded; the composition write-through re-persists LAST_USED.
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem("agentprism.builder.composition") ?? "{}")).toMatchObject({
        temperature: 0.9,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").builder.restoreDefaults }));
    // The draft resets to factory defaults and storage no longer holds the preference.
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem("agentprism.builder.composition") ?? "{}")).toMatchObject({
        temperature: 0,
        framework: "native",
      }),
    );
  });
});
