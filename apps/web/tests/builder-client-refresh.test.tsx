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
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  abortBuilderTurn,
  fetchBuilderSessions,
  streamBuilderChat,
} from "@agentprism/client";
import { getCatalog } from "@/i18n/catalogs";
import { BUILDER_CATALOG, BUILDER_DETAIL, renderBuilderClient } from "./builder-client-fixtures.js";

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  fetchBuilderCatalog: vi.fn(async () => BUILDER_CATALOG),
  fetchBuilderSessions: vi.fn(),
  fetchBuilderSessionDetail: vi.fn(async () => BUILDER_DETAIL),
  abortBuilderTurn: vi.fn(async () => true),
  streamBuilderChat: vi.fn(async () => undefined),
}));

// Minimal view rows: the detached refreshes only read id/running/name; the
// full record shape is irrelevant here.
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
    renderBuilderClient();
    const composer = await screen.findByPlaceholderText(en().chatPlaceholder);
    // The composer appears as soon as a session is selected; the draft
    // composition lands when the detail fetch settles. Sending before that
    // would return early and never reach the detached refresh.
    await screen.findByText(en().boardTitle);
    fireEvent.change(composer, { target: { value: "hi there" } });
    fireEvent.click(screen.getByRole("button", { name: en().send }));
    await waitFor(() => expect(streamBuilderChat).toHaveBeenCalledOnce());
    // Three detached refreshes ran exactly once each: mount, turn start, and
    // the settle resync (the stream mock resolves immediately, so the settle
    // resync can land before the send is even observed).
    await waitFor(() => expect(fetchBuilderSessions).toHaveBeenCalledTimes(3));
    await settle();
    expect(unhandled).toEqual([]);
  });

  it("a rejected refresh after a session-row stop stays handled", async () => {
    watchUnhandled();
    vi.mocked(fetchBuilderSessions).mockResolvedValueOnce(RUNNING_SESSIONS).mockRejectedValue(new Error("backend down"));
    renderBuilderClient();
    // The running state raises two "Stop" buttons (chat panel and session row);
    // the regression targets the session-row one.
    const rowStop = (await screen.findAllByRole("button", { name: en().stop })).find((button) =>
      button.className.includes("builder-session-delete"),
    );
    expect(rowStop).toBeDefined();
    fireEvent.click(rowStop as HTMLElement);
    await waitFor(() => expect(abortBuilderTurn).toHaveBeenCalledWith("s1"));
    // Mount refresh plus the post-abort resync.
    await waitFor(() => expect(fetchBuilderSessions).toHaveBeenCalledTimes(2));
    await settle();
    expect(unhandled).toEqual([]);
  });
});
