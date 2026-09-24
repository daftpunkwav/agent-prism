// @vitest-environment jsdom
/**
 * @file number input tests
 * @description Locks the debounced commit behavior: free typing, idle commit,
 * blur commit, clamping, and integer truncation.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NumberInput } from "../src/NumberInput.js";

/** Stateful harness: a NumberInput whose parent actually applies committed values. */
function Harness({ initial, min, max, integer }: { initial: number; min?: number; max?: number; integer?: boolean }) {
  const [value, setValue] = useState(initial);
  return <NumberInput value={value} onChange={setValue} min={min} max={max} integer={integer} ariaLabel="tokens" />;
}

describe("NumberInput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function type(text: string) {
    const input = screen.getByLabelText("tokens");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
    return input;
  }

  it("commits the parsed value after the typing debounce elapses", () => {
    const onChange = vi.fn();
    render(<NumberInput value={0} min={0} ariaLabel="tokens" onChange={onChange} />);
    type("500");
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(onChange).toHaveBeenCalledWith(500);
  });

  it("lets the user clear the field mid-edit without immediate zero commits", () => {
    const onChange = vi.fn();
    render(<NumberInput value={128000} ariaLabel="tokens" onChange={onChange} />);
    const input = type("");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "500" } });
    vi.advanceTimersByTime(600);
    expect(onChange).toHaveBeenCalledWith(500);
  });

  it("commits immediately and syncs the display on blur", () => {
    render(<Harness initial={0} />);
    const input = type("42");
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe("42");
  });

  it("clamps to min and truncates integers on commit", () => {
    render(<Harness initial={0} min={1024} integer />);
    const input = type("12.9");
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe("1024");
  });

  it("keeps the previous value for unparseable text", () => {
    render(<Harness initial={16} />);
    const input = type("abc");
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe("16");
  });

  it("drops the pending debounce commit on unmount", () => {
    // Cancel-right-after-typing (e.g. closing a modal via Escape) must not
    // resurrect the discarded text through a late onChange.
    const onChange = vi.fn();
    const { unmount } = render(<NumberInput value={0} ariaLabel="tokens" onChange={onChange} />);
    type("500");
    unmount();
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
  });
});
