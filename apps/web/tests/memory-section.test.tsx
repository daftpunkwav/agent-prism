// @vitest-environment jsdom
/**
 * @file memory section tests
 * @description Locks the settings memory panel: status load, refresh, confirmed clear, and failure flash.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMemory, fetchMemoryStatus, type MemoryStatus } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { MemorySection } from "../src/app/settings/MemorySection.js";

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  fetchMemoryStatus: vi.fn(),
  clearMemory: vi.fn(),
}));

const statusMock = vi.mocked(fetchMemoryStatus);
const clearMock = vi.mocked(clearMemory);

const STATUS = {
  episodicCount: 3,
  episodicPath: "data/memory_episodic.json",
  semanticCount: 5,
  semanticPath: "data/memory_semantic.json",
} as unknown as MemoryStatus;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSection(onFlash = vi.fn()) {
  render(
    <I18nProvider initialLocale="en">
      <MemorySection onFlash={onFlash} />
    </I18nProvider>,
  );
  return onFlash;
}

describe("MemorySection", () => {
  it("loads and renders both store counts and paths", async () => {
    statusMock.mockResolvedValue(STATUS);
    renderSection();
    expect(await screen.findByText("3")).toBeDefined();
    expect(screen.getByText("5")).toBeDefined();
    expect(screen.getByText("data/memory_episodic.json")).toBeDefined();
    expect(statusMock).toHaveBeenCalledOnce();
  });

  it("shows the failure state when the status fetch rejects", async () => {
    statusMock.mockRejectedValue(new Error("backend down"));
    renderSection();
    expect(await screen.findByText("backend down")).toBeDefined();
  });

  it("clears both stores only after confirmation and flashes the result", async () => {
    statusMock.mockResolvedValue(STATUS);
    clearMock.mockResolvedValue({ ...STATUS, episodicCount: 0, semanticCount: 0 } as unknown as MemoryStatus);
    const onFlash = renderSection();
    await screen.findByText("3");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.memory.clear }));
    await waitFor(() => expect(onFlash).toHaveBeenCalledWith(getCatalog("en").settings.memory.cleared));
    expect(clearMock).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getAllByText("0")).toHaveLength(2);
  });

  it("declines to clear when the confirm is cancelled", async () => {
    statusMock.mockResolvedValue(STATUS);
    const onFlash = renderSection();
    await screen.findByText("3");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.memory.clear }));
    expect(clearMock).not.toHaveBeenCalled();
    expect(onFlash).not.toHaveBeenCalled();
  });

  it("flashes the error message when the clear call fails", async () => {
    statusMock.mockResolvedValue(STATUS);
    clearMock.mockRejectedValue(new Error("locked"));
    const onFlash = renderSection();
    await screen.findByText("3");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.memory.clear }));
    await waitFor(() => expect(onFlash).toHaveBeenCalledWith("locked"));
  });

  it("disables the clear button when both stores are empty", async () => {
    statusMock.mockResolvedValue({ ...STATUS, episodicCount: 0, semanticCount: 0 } as unknown as MemoryStatus);
    renderSection();
    await screen.findAllByText("0");
    const clear = screen.getByRole("button", { name: getCatalog("en").settings.memory.clear }) as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
  });
});
