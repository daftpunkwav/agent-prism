// @vitest-environment jsdom
/**
 * @file ask user modal tests
 * @description Locks the ask_user channel: option answer, skip-all dismissal, escape scope, close-on-complete.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { AskUserModal, type PendingAskBatch } from "../src/components/AskUserModal.js";

const BATCH: PendingAskBatch = {
  sourceLabel: "Native",
  agentId: "agent-1",
  questions: [
    { id: "q1", header: "Confirm", question: "Proceed now?", options: ["yes", "no"] },
    { id: "q2", header: "", question: "Any notes?", options: [] },
  ],
};

afterEach(cleanup);

function renderModal(overrides?: {
  pending?: PendingAskBatch | null;
  submitting?: boolean;
  onAnswer?: (questionId: string, answer: string) => Promise<boolean>;
  onClose?: () => void;
  variant?: "centered" | "inline";
}) {
  const onAnswer = overrides?.onAnswer ?? vi.fn(async () => true);
  const onClose = overrides?.onClose ?? vi.fn();
  render(
    <I18nProvider initialLocale="en">
      <AskUserModal
        pending={overrides?.pending === undefined ? BATCH : overrides.pending}
        submitting={overrides?.submitting ?? false}
        onAnswer={onAnswer}
        onClose={onClose}
        variant={overrides?.variant}
      />
    </I18nProvider>,
  );
  return { onAnswer, onClose };
}

describe("AskUserModal", () => {
  it("renders nothing without a pending batch", () => {
    renderModal({ pending: null });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("answers through an option chip and marks the question answered", async () => {
    const { onAnswer, onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "yes" }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith("q1", "yes"));
    expect(await screen.findByText(getCatalog("en").common.askAnswered)).toBeDefined();
    // Only q2 remains unanswered: the batch must stay open.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes after the last question is submitted", async () => {
    const { onClose } = renderModal();
    const skips = screen.getAllByRole("button", { name: getCatalog("en").common.askSkip });
    expect(skips).toHaveLength(2);
    fireEvent.click(skips[0]!);
    fireEvent.click(skips[1]!);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("dismissal skips every unanswered question and closes", async () => {
    const { onAnswer, onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").common.cancel }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onAnswer).toHaveBeenCalledWith("q1", "");
    expect(onAnswer).toHaveBeenCalledWith("q2", "");
  });

  it("escape skips the batch only for the centered variant", () => {
    const centered = renderModal();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(centered.onClose).toHaveBeenCalledOnce();

    const inline = renderModal({ variant: "inline" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(inline.onClose).not.toHaveBeenCalled();
  });

  it("disables every control while an answer is in flight", () => {
    renderModal({ submitting: true });
    expect((screen.getAllByRole("button", { name: "yes" })[0] as HTMLButtonElement).disabled).toBe(true);
    const answerInputs = screen.getAllByPlaceholderText(getCatalog("en").common.askAnswerPlaceholder) as HTMLTextAreaElement[];
    expect(answerInputs.every((node) => node.disabled)).toBe(true);
    const send = screen.getAllByRole("button", { name: getCatalog("en").common.askSend })[0] as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it("keeps a question editable when the answer is rejected", async () => {
    renderModal({ onAnswer: vi.fn(async () => false) });
    fireEvent.click(screen.getByRole("button", { name: "no" }));
    await waitFor(() => expect(screen.queryByText(getCatalog("en").common.askAnswered)).toBeNull());
    expect(screen.getAllByRole("button", { name: "no" })).toHaveLength(1);
  });

  it("free text submits through the send button", async () => {
    const { onAnswer } = renderModal();
    const inputs = screen.getAllByPlaceholderText(getCatalog("en").common.askAnswerPlaceholder);
    fireEvent.change(inputs[1]!, { target: { value: "use plan b" } });
    const send = screen.getAllByRole("button", { name: getCatalog("en").common.askSend })[1]!;
    fireEvent.click(send);
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith("q2", "use plan b"));
  });
});
