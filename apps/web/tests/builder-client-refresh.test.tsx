// @vitest-environment jsdom
/**
 * @file builder client refresh tests
 * @description Locks the detached session-list refreshes: a rejection of
 *              fetchBuilderSessions behind a fire-and-forget call site never
 *              surfaces as an unhandled rejection.
 *
 * Covered detached call sites of BuilderClient:
 * - turn start (the "mark the session running" refresh)
 * - turn settle (the post-stream registry resync in .finally)
 * - session-row stop (the resync after abortBuilderTurn in .finally)
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BuilderCatalog, BuilderComposition } from "@agentprism/client";
import {
  abortBuilderTurn,
  fetchBuilderCatalog,
  fetchBuilderSessionDetail,
  fetchBuilderSessions,
  streamBuilderChat,
} from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { BuilderClient } from "../src/app/builder/BuilderClient.js";

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  fetchBuilderCatalog: vi.fn(async () => CATALOG),
  fetchBuilderSessions: vi.fn(),
  fetchBuilderSessionDetail: vi.fn(async () => DETAIL),
  abortBuilderTurn: vi.fn(async () => true),
  streamBuilderChat: vi.fn(async () => undefined),
}));

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

const DETAIL = {
  session: { id: "s1", name: "My agent", composition: COMPOSITION, history: [], workspace: "" },
  records: [],
};

// Minimal view rows: the detached refreshes only read id/running/name; the
// full record shape is irrelevant here (same cast convention as the run tests).
const IDLE_SESSIONS = [{ id: "s1", name: "My agent", running: false, turn_count: 0, workspace: "" }] as never;
const RUNNING_SESSIONS = [{ id: "s1", name: "My agent", running: true, turn_count: 1, workspace: "" }] as never;

const en = () => getCatalog("en").builder;

/** Lets Node flag any rejection left without a handler before the assertion. */
function settle(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 20); });
}

describe("detached session-list refreshes", () => {
  let unhandled: unknown[];
  let onUnhandled: (reason: unknown) => void;

  afterEach(() => {
    cleanup();
    process.off("unhandledRejection", onUnhandled);
    vi.clearAllMocks();
  });

  function watchUnhandled(): void {
    unhandled = [];
    onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
  }

  it("a rejected refresh at turn start and at turn settle stays handled", async () => {
    watchUnhandled();
    // Mount resolves the registry once; every detached refresh afterwards fails.
    vi.mocked(fetchBuilderSessions).mockResolvedValueOnce(IDLE_SESSIONS).mockRejectedValue(new Error("backend down"));
    render(
      <I18nProvider initialLocale="en">
        <BuilderClient />
      </I18nProvider>,
    );
    const composer = await screen.findByPlaceholderText(en().chatPlaceholder);
    // The composer appears as soon as a session is selected; the draft
    // composition lands when the detail fetch settles. Sending before that
    // would return early and never reach the detached refresh.
    await screen.findByText(en().boardTitle);
    fireEvent.change(composer, { target: { value: "hi there" } });
    fireEvent.click(screen.getByRole("button", { name: en().send }));
    await waitFor(() => expect(streamBuilderChat).toHaveBeenCalledOnce());
    await settle();
    expect(unhandled).toEqual([]);
  });

  it("a rejected refresh after a session-row stop stays handled", async () => {
    watchUnhandled();
    vi.mocked(fetchBuilderSessions).mockResolvedValueOnce(RUNNING_SESSIONS).mockRejectedValue(new Error("backend down"));
    render(
      <I18nProvider initialLocale="en">
        <BuilderClient />
      </I18nProvider>,
    );
    // The running state raises two "Stop" buttons (chat panel and session row);
    // the regression targets the session-row one.
    const rowStop = (await screen.findAllByRole("button", { name: en().stop })).find((button) =>
      button.className.includes("builder-session-delete"),
    );
    expect(rowStop).toBeDefined();
    fireEvent.click(rowStop as HTMLElement);
    await waitFor(() => expect(abortBuilderTurn).toHaveBeenCalledWith("s1"));
    await settle();
    expect(unhandled).toEqual([]);
  });
});
