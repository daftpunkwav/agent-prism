// @vitest-environment jsdom
/**
 * @file workspace panel interaction tests
 * @description Locks the workspace browser's failure toasts, toast expiry, pane
 * drag clamping, and the dismiss/cancel/escape interactions.
 *
 * The read/edit/create path is covered by workspace-panel.test.tsx; this file pins
 * what happens when an operation fails and how the panel settles afterwards.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  deleteWorkspaceFile,
  listWorkspaceFiles,
  readWorkspaceFile,
  saveWorkspaceFile,
} from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { WorkspacePanel } from "../src/app/arena/WorkspacePanel.js";

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  listWorkspaceFiles: vi.fn(async () => [
    { path: "src/a.ts", size: 3 },
    { path: "README.md", size: 9 },
  ]),
  readWorkspaceFile: vi.fn(async (_ws: string, path: string) => `content of ${path}`),
  saveWorkspaceFile: vi.fn(async () => undefined),
  deleteWorkspaceFile: vi.fn(async () => undefined),
}));

const listMock = vi.mocked(listWorkspaceFiles);
const readMock = vi.mocked(readWorkspaceFile);
const saveMock = vi.mocked(saveWorkspaceFile);
const deleteMock = vi.mocked(deleteWorkspaceFile);

const en = () => getCatalog("en").arena.ws;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function renderPanel(props?: { workspaceName?: string | null; pollInterval?: number }) {
  return render(
    <I18nProvider initialLocale="en">
      <WorkspacePanel
        workspaceName={props?.workspaceName === undefined ? "ws-native" : props.workspaceName}
        refreshToken={0}
        pollInterval={props?.pollInterval ?? 0}
      />
    </I18nProvider>,
  );
}

async function openReadme(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "README.md" }));
  await waitFor(() => expect(document.body.textContent).toContain("content of README.md"));
}

/** Pointer event with the capture bookkeeping the splitter drag expects. */
function pointer(type: string, init: { clientX: number; pointerId: number }): PointerEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX }) as PointerEvent;
  Object.defineProperty(event, "pointerId", { value: init.pointerId });
  Object.defineProperty(event, "isPrimary", { value: true });
  return event;
}

describe("WorkspacePanel failure handling", { retry: 1 }, () => {
  it("warns without disturbing the list when a poll fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    listMock.mockRejectedValueOnce(new Error("backend down"));
    renderPanel({ pollInterval: 10 });
    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("Failed to refresh file list")));
    // The next poll succeeds and the tree is intact.
    await waitFor(() => expect(screen.getByRole("button", { name: "README.md" })).toBeDefined());
    warn.mockRestore();
  });

  it("reports a failed save in a toast and keeps the editor open", async () => {
    saveMock.mockRejectedValueOnce(new Error("disk full"));
    renderPanel();
    await openReadme();
    fireEvent.click(screen.getByRole("button", { name: en().editAria }));
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "rewritten" } });
    fireEvent.click(screen.getByRole("button", { name: en().save }));
    expect(await screen.findByText(en().saveFailed.replace("{message}", "disk full"))).toBeDefined();
    // The draft survives the failure.
    expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe("rewritten");
  });

  it("reports a failed create and a failed delete in toasts", async () => {
    saveMock.mockRejectedValueOnce(new Error("no space"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: en().newFile }));
    const input = document.querySelector('input[placeholder="main.py"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "new.py" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText(en().createFailed.replace("{message}", "no space"))).toBeDefined();

    deleteMock.mockRejectedValueOnce(new Error("read-only"));
    await openReadme();
    fireEvent.click(screen.getByRole("button", { name: en().deleteAria }));
    expect(await screen.findByText(en().deleteFailed.replace("{message}", "read-only"))).toBeDefined();
  });

  it("keeps the file when the delete confirmation is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPanel();
    await openReadme();
    fireEvent.click(screen.getByRole("button", { name: en().deleteAria }));
    expect(deleteMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("content of README.md");
  });

  it("expires the toast on its own timer", async () => {
    saveMock.mockRejectedValueOnce(new Error("disk full"));
    renderPanel();
    await openReadme();
    fireEvent.click(screen.getByRole("button", { name: en().editAria }));
    fireEvent.click(screen.getByRole("button", { name: en().save }));
    expect(await screen.findByText(en().saveFailed.replace("{message}", "disk full"))).toBeDefined();
    // The toast clears itself without a dismissal click.
    await waitFor(() => expect(document.body.textContent).not.toContain("disk full"), { timeout: 5_000 });
  });

  it("aborts in-flight requests on unmount", async () => {
    const signals: AbortSignal[] = [];
    listMock.mockImplementationOnce(async (_ws: string, signal?: AbortSignal) => {
      if (signal !== undefined) signals.push(signal);
      return [{ path: "README.md", size: 9 }];
    });
    const { unmount } = renderPanel();
    await waitFor(() => expect(signals.length).toBeGreaterThan(0));
    unmount();
    expect(signals[0]?.aborted).toBe(true);
  });

  it("aborts the previous read when another file is opened", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    readMock
      // The first read never answers on its own: opening another file must abort it.
      .mockImplementationOnce(async (_ws, _path, signal) => {
        signals.push(signal);
        return new Promise<string>(() => {});
      })
      .mockImplementationOnce(async (_ws, path, signal) => {
        signals.push(signal);
        return `content of ${path}`;
      });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "README.md" }));
    await waitFor(() => expect(signals).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "src" }));
    fireEvent.click(screen.getByRole("button", { name: "a.ts" }));
    await waitFor(() => expect(document.body.textContent).toContain("content of src/a.ts"));
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });
});

describe("WorkspacePanel interactions", { retry: 1 }, () => {
  it("collapses an expanded directory again", async () => {
    renderPanel();
    const dir = await screen.findByRole("button", { name: "src" });
    fireEvent.click(dir);
    expect(await screen.findByRole("button", { name: "a.ts" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "src" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "a.ts" })).toBeNull());
  });

  it("drops an empty draft on Escape and closes the viewer on request", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: en().newFile }));
    const input = document.querySelector('input[placeholder="main.py"]') as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.getAttribute("tabindex")).toBe("-1");
    expect(saveMock).not.toHaveBeenCalled();

    await openReadme();
    fireEvent.click(screen.getByRole("button", { name: en().closeAria }));
    await waitFor(() => expect(screen.getByText(en().selectFile)).toBeDefined());
  });

  it("returns from the source view to the markdown preview", async () => {
    renderPanel();
    await openReadme();
    fireEvent.click(screen.getByRole("button", { name: en().sourceView }));
    await waitFor(() => expect(document.querySelector("pre.code-view")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: en().previewView }));
    await waitFor(() => expect(document.querySelector(".ws-md-preview")).not.toBeNull());
  });

  it("abandons an edit without saving", async () => {
    renderPanel();
    await openReadme();
    fireEvent.click(screen.getByRole("button", { name: en().editAria }));
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "scratch" } });
    fireEvent.click(screen.getByRole("button", { name: en().cancel }));
    expect(saveMock).not.toHaveBeenCalled();
    // The viewer is back on the stored content.
    expect(document.body.textContent).toContain("content of README.md");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("clamps the pane split while dragging and stops tracking on release", async () => {
    renderPanel();
    const splitter = await screen.findByRole("separator", { name: en().splitterAria });
    const split = splitter.parentElement as HTMLElement;
    Object.defineProperty(split, "clientWidth", { configurable: true, value: 400 });
    (splitter as HTMLElement).setPointerCapture = vi.fn();
    (splitter as HTMLElement).releasePointerCapture = vi.fn();
    (splitter as HTMLElement).hasPointerCapture = vi.fn(() => true);
    const before = Number(splitter.getAttribute("aria-valuenow"));

    // A right drag widens the left pane; a huge drag clamps at the maximum.
    fireEvent(splitter, pointer("pointerdown", { clientX: 100, pointerId: 1 }));
    fireEvent(splitter, pointer("pointermove", { clientX: 140, pointerId: 1 }));
    const widened = Number(splitter.getAttribute("aria-valuenow"));
    expect(widened).toBeGreaterThan(before);
    fireEvent(splitter, pointer("pointermove", { clientX: 100_000, pointerId: 1 }));
    expect(splitter.getAttribute("aria-valuenow")).toBe(splitter.getAttribute("aria-valuemax"));
    // A left drag past the start clamps at the minimum.
    fireEvent(splitter, pointer("pointermove", { clientX: -100_000, pointerId: 1 }));
    expect(splitter.getAttribute("aria-valuenow")).toBe(splitter.getAttribute("aria-valuemin"));

    fireEvent(splitter, pointer("pointerup", { clientX: 0, pointerId: 1 }));
    fireEvent(splitter, pointer("pointermove", { clientX: 300, pointerId: 1 }));
    // Released: the fraction stays where the last drag left it.
    expect(splitter.getAttribute("aria-valuenow")).toBe(splitter.getAttribute("aria-valuemin"));
  });
});
