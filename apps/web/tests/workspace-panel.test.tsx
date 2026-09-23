// @vitest-environment jsdom
/**
 * @file workspace panel tests
 * @description Locks the workspace browser: tree render, read/edit/save, create, delete, and refresh token.
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
    { path: "src/lib/util.ts", size: 5 },
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
});

function renderPanel(props?: { workspaceName?: string | null; refreshToken?: number; pollInterval?: number }) {
  return render(
    <I18nProvider initialLocale="en">
      <WorkspacePanel
        workspaceName={props?.workspaceName === undefined ? "ws-native" : props.workspaceName}
        refreshToken={props?.refreshToken ?? 0}
        pollInterval={props?.pollInterval ?? 0}
      />
    </I18nProvider>,
  );
}

/** Clicks a tree file button by its visible label and waits for the read to land.
 *  Matches on body text: highlighted source views split content across spans. */
async function openFile(path: string, label: string) {
  fireEvent.click(await screen.findByRole("button", { name: label }));
  await waitFor(() => expect(document.body.textContent).toContain(`content of ${path}`));
}

describe("WorkspacePanel", () => {
  it("shows the empty state without a workspace", () => {
    renderPanel({ workspaceName: null });
    expect(screen.getByText(en().empty)).toBeDefined();
    expect(listMock).not.toHaveBeenCalled();
  });

  it("renders a nested tree, expands directories, and reads files on click", async () => {
    renderPanel();
    // Directories render collapsed: their files stay hidden until expanded.
    const dirButton = await screen.findByRole("button", { name: "src" });
    expect(screen.queryByRole("button", { name: "a.ts" })).toBeNull();
    fireEvent.click(dirButton);
    expect(await screen.findByRole("button", { name: "a.ts" })).toBeDefined();
    // Nested directories stay collapsed until their own toggle.
    expect(screen.queryByRole("button", { name: "util.ts" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "lib" }));
    fireEvent.click(await screen.findByRole("button", { name: "util.ts" }));
    await waitFor(() => expect(readMock).toHaveBeenCalledWith("ws-native", "src/lib/util.ts", expect.anything()));
    await openFile("src/a.ts", "a.ts");
    expect(readMock).toHaveBeenCalledWith("ws-native", "src/a.ts", expect.anything());
  });

  it("edits and saves a file, then refreshes the list", async () => {
    renderPanel();
    await openFile("README.md", "README.md");
    fireEvent.click(screen.getByRole("button", { name: en().editAria }));
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("content of README.md");
    fireEvent.change(textarea, { target: { value: "rewritten" } });
    fireEvent.click(screen.getByRole("button", { name: en().save }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith("ws-native", "README.md", "rewritten", false, expect.anything()));
    expect(await screen.findByText(en().saved)).toBeDefined();
    await waitFor(() => expect(listMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("creates a new file through the inline form", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: en().newFile }));
    const input = document.querySelector('input[placeholder="main.py"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "new.py" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith("ws-native", "new.py", "", true, expect.anything()));
    expect(await screen.findByText(en().created.replace("{path}", "new.py"))).toBeDefined();
    // The created file becomes the selected file.
    await waitFor(() => expect(document.body.textContent).toContain("content of new.py"));
  });

  it("deletes the selected file after confirmation and clears the viewer", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPanel();
    await openFile("README.md", "README.md");
    fireEvent.click(screen.getByRole("button", { name: en().deleteAria }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("ws-native", "README.md", expect.anything()));
    expect(await screen.findByText(en().deleted)).toBeDefined();
    expect(screen.getByText(en().selectFile)).toBeDefined();
    expect(confirm).toHaveBeenCalledWith(en().confirmDelete.replace("{path}", "README.md"));
  });

  it("keeps a read failure out of the editable content", async () => {
    // One-shot rejection: a sticky implementation would leak into later tests.
    readMock.mockRejectedValueOnce(new Error("permission denied"));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "README.md" }));
    expect(await screen.findByText(en().loadFailed.replace("{message}", "permission denied"))).toBeDefined();
  });

  it("re-polls when the refresh token bumps", async () => {
    const { rerender } = renderPanel({ refreshToken: 0 });
    await waitFor(() => expect(listMock.mock.calls.length).toBeGreaterThanOrEqual(1));
    rerender(
      <I18nProvider initialLocale="en">
        <WorkspacePanel workspaceName="ws-native" refreshToken={1} pollInterval={0} />
      </I18nProvider>,
    );
    await waitFor(() => expect(listMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("opens markdown files in preview and toggles to the highlighted source view", async () => {
    renderPanel();
    await openFile("README.md", "README.md");
    // Markdown defaults to the rendered preview; the toggle starts on Preview.
    const previewBtn = screen.getByRole("button", { name: en().previewView });
    expect(previewBtn.getAttribute("data-active")).toBe("true");
    expect(document.querySelector(".ws-md-preview")).not.toBeNull();
    const sourceBtn = screen.getByRole("button", { name: en().sourceView });
    fireEvent.click(sourceBtn);
    await waitFor(() => expect(document.querySelector("pre.code-view")).not.toBeNull());
    expect(sourceBtn.getAttribute("data-active")).toBe("true");
  });

  it("renders source files through the highlighted code view", async () => {
    renderPanel();
    // Directories start collapsed; expand src before its file is reachable.
    fireEvent.click(await screen.findByRole("button", { name: "src" }));
    await openFile("src/a.ts", "a.ts");
    expect(document.querySelector("pre.code-view")).not.toBeNull();
    // Highlight spans exist (token kinds break the text across elements).
    expect(document.querySelectorAll("pre.code-view span[class^='hl-']").length).toBeGreaterThan(0);
  });

  it("exposes the pane splitter with clamped range metadata", async () => {
    renderPanel();
    const splitter = await screen.findByRole("separator", { name: en().splitterAria });
    expect(splitter.getAttribute("aria-valuemin")).toBe("15");
    expect(splitter.getAttribute("aria-valuemax")).toBe("80");
    const now = Number(splitter.getAttribute("aria-valuenow"));
    expect(now).toBeGreaterThanOrEqual(15);
    expect(now).toBeLessThanOrEqual(80);
  });
});
