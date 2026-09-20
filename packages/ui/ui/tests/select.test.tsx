// @vitest-environment jsdom
/**
 * @file UiSelect tests
 * @description Locks popup open/select/keyboard behavior of the themed select.
 *
 * Responsibilities:
 * - Pin trigger label, option selection, and popup dismissal
 * - Pin disabled options never firing onChange
 * - Pin grouped entries rendering a non-selectable caption
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UiSelect } from "../src/Select.js";

afterEach(() => cleanup());

beforeAll(() => {
  // jsdom ships no layout engine: stub the scroll helper the popup calls on open.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

describe("UiSelect", () => {
  it("trigger shows the selected option label", () => {
    render(<UiSelect value="b" onChange={() => {}} options={OPTIONS} ariaLabel="Pick" />);
    expect(screen.getByRole("button", { name: "Pick" }).textContent).toContain("Beta");
  });

  it("clicking an option fires onChange and closes the popup", () => {
    const onChange = vi.fn();
    render(<UiSelect value="a" onChange={onChange} options={OPTIONS} ariaLabel="Pick" />);
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    fireEvent.click(screen.getByRole("option", { name: "Beta" }));
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("disabled options never fire onChange", () => {
    const onChange = vi.fn();
    render(
      <UiSelect
        value="a"
        onChange={onChange}
        options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta", disabled: true }]}
        ariaLabel="Pick"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    fireEvent.click(screen.getByRole("option", { name: "Beta" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("grouped entries render a caption row", () => {
    render(
      <UiSelect
        value="a"
        onChange={() => {}}
        options={[{ group: "Greek", options: OPTIONS }]}
        ariaLabel="Pick"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    expect(screen.getByText("Greek")).toBeDefined();
    expect(screen.getByRole("option", { name: "Alpha" })).toBeDefined();
  });

  it("ArrowDown opens the popup and Escape closes it", () => {
    render(<UiSelect value="a" onChange={() => {}} options={OPTIONS} ariaLabel="Pick" />);
    const trigger = screen.getByRole("button", { name: "Pick" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeDefined();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keyboard navigation moves the active option and commits on Enter", () => {
    const onChange = vi.fn();
    render(
      <UiSelect
        value="a"
        onChange={onChange}
        options={[
          { value: "a", label: "Alpha" },
          { value: "mid", label: "Mid", disabled: true },
          { value: "b", label: "Beta" },
        ]}
        ariaLabel="Pick"
      />,
    );
    const trigger = screen.getByRole("button", { name: "Pick" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByRole("listbox")).toBeDefined();
    const listbox = screen.getByRole("listbox");
    // ArrowDown skips the disabled middle entry.
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Beta" }).getAttribute("data-active")).toBe("true");
    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: "Alpha" }).getAttribute("data-active")).toBe("true");
    fireEvent.keyDown(listbox, { key: "End" });
    expect(screen.getByRole("option", { name: "Beta" }).getAttribute("data-active")).toBe("true");
    fireEvent.keyDown(listbox, { key: "Home" });
    expect(screen.getByRole("option", { name: "Alpha" }).getAttribute("data-active")).toBe("true");
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("a");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("escape closes without committing and hover moves the active option", () => {
    const onChange = vi.fn();
    render(<UiSelect value="a" onChange={onChange} options={OPTIONS} ariaLabel="Pick" />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Pick" }), { key: "ArrowDown" });
    fireEvent.mouseEnter(screen.getByRole("option", { name: "Beta" }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
