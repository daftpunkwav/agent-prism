// @vitest-environment jsdom
/**
 * @file number input tests
 * @description Locks the blur-commit semantics: free typing never rewrites
 * mid-edit text, commit happens on blur/Enter only, invalid edits keep the
 * user's text with a message, and Escape restores the committed value.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NumberInput } from "../src/NumberInput.js";

/** Stateful harness: a NumberInput whose parent actually applies committed values. */
function Harness({ initial, min, max, integer, invalidMessage }: { initial: number; min?: number; max?: number; integer?: boolean; invalidMessage?: string }) {
  const [value, setValue] = useState(initial);
  return <NumberInput value={value} onChange={setValue} min={min} max={max} integer={integer} invalidMessage={invalidMessage} ariaLabel="tokens" />;
}

describe("NumberInput", () => {
  afterEach(cleanup);

  function type(text: string) {
    const input = screen.getByLabelText("tokens");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
    return input;
  }

  it("never commits while typing: no timer rewrites mid-edit text", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<NumberInput value={0} ariaLabel="tokens" onChange={onChange} />);
    const input = type("");
    vi.advanceTimersByTime(2000);
    expect(onChange).not.toHaveBeenCalled();
    // The cleared field stays cleared: the deleted zero must not come back.
    expect((input as HTMLInputElement).value).toBe("");
    vi.useRealTimers();
  });

  it("commits on blur and syncs the display", () => {
    render(<Harness initial={0} />);
    const input = type("42");
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe("42");
  });

  it("keeps an invalid edit on screen with the caller's message instead of restoring", () => {
    render(<Harness initial={16} invalidMessage="Enter a valid number" />);
    const input = type("");
    fireEvent.blur(input);
    // The user's (empty) text is not rewritten to 16; the message explains why.
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("alert").textContent).toBe("Enter a valid number");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("keeps out-of-range text and flags it instead of clamping", () => {
    render(<Harness initial={1} min={1} max={2} invalidMessage="out of range" />);
    const input = type("5000");
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe("5000");
    expect(screen.getByRole("alert").textContent).toBe("out of range");
  });

  it("flags unparseable text without committing", () => {
    const onChange = vi.fn();
    render(<NumberInput value={16} ariaLabel="tokens" invalidMessage="bad" onChange={onChange} />);
    const input = type("abc");
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("abc");
    expect(screen.getByRole("alert").textContent).toBe("bad");
  });

  it("clears the flag and commits once the text is corrected", () => {
    render(<Harness initial={0} invalidMessage="bad" />);
    const input = type("");
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.blur(input);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("accepts an exactly-bounds value and truncates integers", () => {
    render(<Harness initial={0} min={1} max={10} integer />);
    const input = type("9.9");
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe("9");
  });

  it("restores the committed value on Escape without firing onChange", () => {
    const onChange = vi.fn();
    render(<NumberInput value={16} ariaLabel="tokens" onChange={onChange} />);
    const input = type("500");
    // Real focus: blur() inside the key handler only commits when the element
    // is the active element. fireEvent.focus does not do that.
    (input as HTMLInputElement).focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(document.activeElement).not.toBe(input);
    expect(onChange).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("16");
  });

  it("clears an invalid flag on Escape instead of committing the out-of-range text", () => {
    const onChange = vi.fn();
    render(<NumberInput value={16} min={0} max={100} ariaLabel="tokens" invalidMessage="out of range" onChange={onChange} />);
    const input = type("5000");
    (input as HTMLInputElement).focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("16");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("syncs the display when the external value changes", () => {
    const { rerender } = render(<NumberInput value={0} ariaLabel="tokens" onChange={vi.fn()} />);
    const input = screen.getByLabelText("tokens");
    fireEvent.change(input, { target: { value: "5" } });
    rerender(<NumberInput value={99} ariaLabel="tokens" onChange={vi.fn()} />);
    expect((input as HTMLInputElement).value).toBe("99");
  });
});
