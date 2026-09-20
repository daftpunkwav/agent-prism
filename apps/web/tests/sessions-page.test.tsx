// @vitest-environment jsdom
/**
 * @file sessions-page tests
 * @description Locks the run-history page: list, expand, delete flows.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import SessionsPage from "../src/app/sessions/page.js";

vi.mock("@agentprism/client", () => ({
  listSessions: vi.fn(async () => [
    {
      id: "s1",
      kind: "arena",
      title: "first run",
      status: "completed",
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
      summary: "done",
      metadata: {},
      entryCount: 1,
    },
  ]),
  getSessionDetail: vi.fn(async () => ({
    record: { id: "s1", kind: "arena", title: "first run", status: "completed" },
    entries: [{ sessionId: "s1", seq: 0, at: 1700000000000, kind: "note", content: "milestone one" }],
  })),
  deleteSession: vi.fn(async () => {}),
  getSessionStats: vi.fn(async () => ({
    total: 1,
    byKind: { arena: 1, agent: 0, builder: 0 },
    byStatus: { active: 0, completed: 1, failed: 0, cancelled: 0 },
  })),
  exportSession: vi.fn(async () => ({ version: 1, exportedAt: 1700000000000, record: {}, entries: [] })),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <I18nProvider initialLocale="en">
      <SessionsPage />
    </I18nProvider>,
  );
}

describe("sessions page", () => {
  it("lists records with status and expands milestones", async () => {
    renderPage();
    expect(await screen.findByText("first run")).toBeDefined();
    expect(screen.getAllByText("Completed")).toHaveLength(2);
    fireEvent.click(screen.getByText(/1 milestones/));
    expect(await screen.findByText("milestone one")).toBeDefined();
  });

  it("filters the ledger by kind", async () => {
    const { listSessions } = await import("@agentprism/client");
    renderPage();
    expect(await screen.findByText("first run")).toBeDefined();
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by kind" }), {
      target: { value: "arena" },
    });
    await waitFor(() => expect(listSessions).toHaveBeenCalledWith({ kind: "arena" }, expect.anything()));
  });

  it("shows ledger stats and exports a record", async () => {
    const { exportSession } = await import("@agentprism/client");
    renderPage();
    expect(await screen.findByText(/1 runs/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Export run record/ }));
    await waitFor(() => expect(exportSession).toHaveBeenCalledWith("s1"));
  });

  it("deletes a record after confirm", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    expect(await screen.findByText("first run")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Delete run record/ }));
    await waitFor(() => expect(screen.queryByText("first run")).toBeNull());
    expect(confirm).toHaveBeenCalledOnce();
  });
});
