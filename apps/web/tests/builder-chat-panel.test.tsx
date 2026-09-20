// @vitest-environment jsdom
/**
 * @file builder chat panel tests
 * @description Locks composer attachments: pick, chip, remove, and send handoff.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { ChatPanel } from "../src/app/builder/ChatPanel.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPanel(onSend: (message: string, attachments: Array<{ name: string; content: string }>) => void) {
  return render(
    <I18nProvider initialLocale="en">
      <ChatPanel history={[]} hasSession running={false} liveSegments={[]} onSend={onSend} onStop={() => {}} />
    </I18nProvider>,
  );
}

function attachFile(name: string, content: string): void {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
  if (input === null) throw new Error("file input missing");
  const file = new File([content], name, { type: "text/plain" });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("builder chat panel attachments", () => {
  it("hands picked files to onSend and clears the composer", async () => {
    const onSend = vi.fn();
    renderPanel(onSend);
    attachFile("a.txt", "hello-file");
    expect(await screen.findByText("a.txt")).toBeDefined();
    fireEvent.change(screen.getByPlaceholderText(/Give the agent a task/), { target: { value: "use it" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("use it", [{ name: "a.txt", content: "hello-file" }]);
    await waitFor(() => expect(screen.queryByText("a.txt")).toBeNull());
  });

  it("removes a chip without sending", async () => {
    const onSend = vi.fn();
    renderPanel(onSend);
    attachFile("b.txt", "bye");
    expect(await screen.findByText("b.txt")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Remove attachment b.txt" }));
    await waitFor(() => expect(screen.queryByText("b.txt")).toBeNull());
    expect(onSend).not.toHaveBeenCalled();
  });
});
