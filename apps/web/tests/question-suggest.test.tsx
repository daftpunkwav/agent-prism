// @vitest-environment jsdom
/**
 * @file question suggest tests
 * @description Locks the composer suggestion listbox: portal render, pick/hover, outside-dismiss.
 */

import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuestionSuggest, type SuggestItem } from "../src/app/arena/QuestionSuggest.js";

const ITEMS: SuggestItem[] = [
  { id: "tpl-1", name: "Template one", question: "First suggestion" },
  { id: "", name: "Free-form", question: "Second suggestion" },
];

function Harness(props: { items: SuggestItem[]; activeIndex: number; onPick?: (item: SuggestItem) => void }) {
  const anchorRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input ref={anchorRef} aria-label="composer" />
      <QuestionSuggest
        anchorRef={anchorRef}
        items={props.items}
        activeIndex={props.activeIndex}
        ariaLabel="suggestions"
        onPick={props.onPick ?? (() => {})}
        onHover={() => {}}
        onClose={() => {}}
      />
    </div>
  );
}

afterEach(cleanup);

describe("QuestionSuggest", () => {
  it("renders options through the portal with the active selection", () => {
    render(<Harness items={ITEMS} activeIndex={1} />);
    const listbox = screen.getByRole("listbox", { name: "suggestions" });
    expect(listbox).toBeDefined();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("First suggestion")).toBeDefined();
  });

  it("renders nothing without items", () => {
    render(<Harness items={[]} activeIndex={0} />);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("picks an option on pointer down and click without losing the anchor", () => {
    const onPick = vi.fn();
    render(<Harness items={ITEMS} activeIndex={0} onPick={onPick} />);
    const option = screen.getAllByRole("option")[0]!;
    fireEvent.mouseDown(option);
    expect(onPick).toHaveBeenCalledWith(ITEMS[0]);
    fireEvent.click(option);
    expect(onPick).toHaveBeenCalledTimes(2);
  });

  it("closes on an outside pointer press but not on presses inside the popup", () => {
    const onClose = vi.fn();
    function Closable() {
      const anchorRef = useRef<HTMLInputElement>(null);
      return (
        <div>
          <input ref={anchorRef} aria-label="composer" />
          <QuestionSuggest
            anchorRef={anchorRef}
            items={ITEMS}
            activeIndex={0}
            ariaLabel="suggestions"
            onPick={() => {}}
            onHover={() => {}}
            onClose={onClose}
          />
        </div>
      );
    }
    render(<Closable />);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
    onClose.mockClear();
    fireEvent.pointerDown(screen.getAllByRole("option")[0]!);
    expect(onClose).not.toHaveBeenCalled();
    onClose.mockClear();
    fireEvent.pointerDown(screen.getByLabelText("composer"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
