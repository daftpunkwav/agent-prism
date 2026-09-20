// @vitest-environment jsdom
/**
 * @file chat panel history tests
 * @description Locks the builder conversation: bubbles, collapsed turn traces, live turn, todo preview, oversize attachments.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RunAttachment } from "@agentprism/client";
import type { DisplaySegment } from "@agentprism/arena-view";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { ChatPanel, type ChatEntry } from "../src/app/builder/ChatPanel.js";

const en = () => getCatalog("en").builder;

afterEach(cleanup);

function renderChat(props: {
  history?: ChatEntry[];
  hasSession?: boolean;
  running?: boolean;
  liveSegments?: DisplaySegment[];
} = {}) {
  const onSend = vi.fn();
  const onStop = vi.fn();
  render(
    <I18nProvider initialLocale="en">
      <ChatPanel
        history={props.history ?? []}
        hasSession={props.hasSession ?? true}
        running={props.running ?? false}
        liveSegments={props.liveSegments ?? []}
        onSend={onSend}
        onStop={onStop}
      />
    </I18nProvider>,
  );
  return { onSend, onStop };
}

describe("ChatPanel history and live turn", () => {
  it("shows the empty hint without a session", () => {
    renderChat({ hasSession: false });
    expect(screen.getByText(en().noSession)).toBeDefined();
  });

  it("renders settled turns: user bubble, collapsed work trail, and the answer", () => {
    renderChat({
      history: [
        { role: "user", content: "build it" },
        {
          role: "assistant",
          content: "done, here you go",
          segments: [
            { id: "s1", kind: "thought", step: 1, turn: 1, text: "reasoning away", completed: true },
          ] as unknown as DisplaySegment[],
        },
      ],
    });
    expect(screen.getByText("build it")).toBeDefined();
    expect(screen.getByText("done, here you go")).toBeDefined();
    // The work trail collapses to a phase count until expanded.
    expect(screen.getByText(en().turnTrace)).toBeDefined();
    fireEvent.click(screen.getByText(en().turnTrace));
    expect(screen.getByText(en().phaseSummary.thinking.replace("{count}", "1"))).toBeDefined();
  });

  it("renders the live turn with a stop control and disables the composer", () => {
    const { onStop } = renderChat({
      running: true,
      liveSegments: [
        { id: "s1", kind: "thought", step: 1, turn: 1, text: "streaming live", completed: false },
      ] as unknown as DisplaySegment[],
    });
    expect(screen.getByText(en().liveTrace)).toBeDefined();
    // The live tail auto-expands so streamed text stays visible.
    expect(screen.getByText(/streaming live/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en().stop) }));
    expect(onStop).toHaveBeenCalledOnce();
    expect((screen.getByPlaceholderText(en().chatPlaceholder) as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: en().send }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders a todo_write action as a structured progress preview", () => {
    renderChat({
      running: true,
      liveSegments: [
        {
          id: "s1",
          kind: "action",
          step: 1,
          turn: 1,
          text: "",
          tool: "todo_write",
          args: {
            todos: [
              { content: "scaffold", status: "completed" },
              { content: "wire up", status: "in_progress" },
            ],
          },
          result: "",
          resultDone: false,
        },
      ] as unknown as DisplaySegment[],
    });
    const progress = en().todoProgress.replace("{done}", "1").replace("{total}", "2");
    expect(screen.getByText(progress)).toBeDefined();
    expect(screen.getByText("scaffold")).toBeDefined();
    expect(screen.getByText(en().todoActive)).toBeDefined();
  });

  it("rejects oversize attachments with the too-large error", async () => {
    renderChat();
    const big = new File(["x".repeat(70 * 1024)], "big.txt");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText(en().attach.tooLarge.replace("{name}", "big.txt"))).toBeDefined();
  });

  it("hands the trimmed draft and staged attachments to onSend", async () => {
    const { onSend } = renderChat();
    const composer = screen.getByPlaceholderText(en().chatPlaceholder) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "  do it  " } });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["abc"], "ctx.txt")] } });
    expect(await screen.findByText("ctx.txt")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: en().send }));
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith("do it", [{ name: "ctx.txt", content: "abc" }] as unknown as RunAttachment[]),
    );
  });
});
