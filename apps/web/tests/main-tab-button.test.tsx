// @vitest-environment jsdom
/**
 * @file main tab button tests
 * @description Locks the Arena stage tab: selection state, disable reason, and badge.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MainTabButton } from "../src/app/arena/MainTabButton.js";

afterEach(cleanup);

describe("MainTabButton", () => {
  it("exposes tab semantics and forwards clicks when enabled", () => {
    const onClick = vi.fn();
    render(
      <MainTabButton active label="Results" icon={<i>ico</i>} onClick={onClick} badge={3} />,
    );
    const tab = screen.getByRole("tab", { name: /Results/ });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("3")).toBeDefined();
    fireEvent.click(tab);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("disables with the reason as tooltip and swallows clicks", () => {
    const onClick = vi.fn();
    render(
      <MainTabButton
        active={false}
        label="Diff"
        icon={null}
        onClick={onClick}
        disabled
        disabledReason="run first"
      />,
    );
    const tab = screen.getByRole("tab", { name: "Diff" });
    expect(tab.getAttribute("aria-disabled")).toBe("true");
    expect(tab.getAttribute("title")).toBe("run first");
    expect(screen.queryByRole("tab", { name: /Diff \d/ })).toBeNull();
    fireEvent.click(tab);
    expect(onClick).not.toHaveBeenCalled();
  });
});
