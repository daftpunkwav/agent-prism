// @vitest-environment jsdom
/**
 * @file builder column layout tests
 * @description Locks the Builder shell's column layout: persisted widths, the
 * fraction bounds per visible-column count, and both resize gestures.
 *
 * Responsibilities:
 * - Pin that a stored layout is restored, clamped to the active bounds, and written back
 * - Pin the pointer gesture contract: travel past the threshold resizes, a clean
 *   press-and-release toggles, extra fingers and non-primary buttons are ignored
 * - Pin the keyboard parity: arrows resize within bounds, Enter/Space toggle
 *
 * Bounds under test (`clampSideW`): with one side open the two visible columns
 * allow [1/3, 2/3] of the column area per side; with both open the three-column
 * case allows [1/4, 1/2] and additionally caps a side by what the chat column
 * needs — `(1 - minFrac) * total - otherSideW`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BuilderCatalog } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { BuilderClient } from "../src/app/builder/BuilderClient.js";

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  fetchBuilderCatalog: vi.fn(async () => CATALOG),
  fetchBuilderSessions: vi.fn(async () => SESSIONS),
  fetchBuilderSessionDetail: vi.fn(async () => DETAIL),
}));

const CATALOG = { capabilities: [], endpoints: [], frameworks: [], tools: [] } as unknown as BuilderCatalog;
const COMPOSITION = { framework: "native", tools: [] } as never;
const SESSIONS = [{ id: "s1", name: "My agent", running: false, turn_count: 0, workspace: "" }] as never[];
const DETAIL = { session: { id: "s1", name: "My agent", composition: COMPOSITION, history: [], workspace: "" }, records: [] };

const LAYOUT_KEY = "agentprism.builder.layout";
const en = () => getCatalog("en").builder;

/** jsdom reports no layout: the shell's column area is stubbed for the clamp math. */
function stubColumnWidth(px: number): void {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => px });
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () => ({ columnGap: "0px", paddingLeft: "0px", paddingRight: "0px" }) as unknown as CSSStyleDeclaration,
  );
}

function shell(): HTMLElement {
  const node = document.querySelector(".builder-shell");
  if (!(node instanceof HTMLElement)) throw new Error("builder shell not rendered");
  return node;
}

const leftWidth = (): string => shell().style.getPropertyValue("--builder-left");
const rightWidth = (): string => shell().style.getPropertyValue("--builder-right");

async function renderBuilder(): Promise<void> {
  render(
    <I18nProvider initialLocale="en">
      <BuilderClient />
    </I18nProvider>,
  );
  await act(async () => {});
}

/** A pointer event shaped the way React handlers read it (jsdom has no PointerEvent). */
function pointer(
  type: string,
  init: { clientX: number; clientY: number; pointerId?: number; button?: number; isPrimary?: boolean },
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: init.clientX,
    clientY: init.clientY,
    button: init.button ?? 0,
  }) as unknown as PointerEvent;
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  Object.defineProperty(event, "isPrimary", { value: init.isPrimary ?? true });
  return event;
}

const handleFor = (side: "left" | "right"): Element => {
  const node = document.querySelector(`[data-side="${side}"].builder-resize-handle, [data-side="${side}"].builder-edge-line`);
  if (!(node instanceof Element)) throw new Error(`no ${side} handle rendered`);
  return node;
};

const boardColumn = (): Element | null => document.querySelector(".builder-col-board");
const traceColumn = (): Element | null => document.querySelector(".builder-col-trace");

/** Press, move, release on one handle as a single gesture (one pointer, primary button). */
function drag(side: "left" | "right", fromX: number, toX: number, options: { release?: boolean } = {}): void {
  const handle = handleFor(side);
  fireEvent(handle, pointer("pointerdown", { clientX: fromX, clientY: 300 }));
  fireEvent(window, pointer("pointermove", { clientX: toX, clientY: 300 }));
  if (options.release !== false) fireEvent(window, pointer("pointerup", { clientX: toX, clientY: 300 }));
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("BuilderClient column layout", () => {
  it("restores a stored layout, clamps it to the three-column bounds, and writes it back", async () => {
    stubColumnWidth(900);
    // Both sides stored wide: the three-column bounds cap each side at 1/2 of the
    // area, and a side is further capped by the chat column's minimum share.
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify({ leftW: 900, rightW: 10, leftOpen: true, rightOpen: true }));
    await renderBuilder();

    expect(leftWidth()).toBe("450px");
    // Right runs second against the already-clamped left: 0.75 * 900 - 450 = 225.
    expect(rightWidth()).toBe("225px");
    // The clamped values are written back, so the next visit starts from them.
    const stored = JSON.parse(window.localStorage.getItem(LAYOUT_KEY) ?? "{}") as { leftW: number; rightW: number };
    expect(stored).toMatchObject({ leftW: 450, rightW: 225 });
  });

  it("uses the wider two-column bounds when one side is collapsed", async () => {
    stubColumnWidth(900);
    // Only the board is open: two visible columns allow [300, 600] per side.
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify({ leftW: 900, rightW: 420, leftOpen: true, rightOpen: false }));
    await renderBuilder();
    expect(leftWidth()).toBe("600px");
    expect(rightWidth()).toBe("auto");
  });

  it("falls back to the defaults when the stored layout is corrupt", async () => {
    stubColumnWidth(900);
    window.localStorage.setItem(LAYOUT_KEY, "{not json");
    await renderBuilder();
    expect(leftWidth()).toBe("320px");
    expect(rightWidth()).toBe("420px");
  });

  it("re-clamps open widths when the viewport shrinks", async () => {
    let width = 1200;
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width });
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () => ({ columnGap: "0px", paddingLeft: "0px", paddingRight: "0px" }) as unknown as CSSStyleDeclaration,
    );
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify({ leftW: 700, rightW: 700, leftOpen: true, rightOpen: true }));
    await renderBuilder();
    // 1200px area: left is capped by 0.75 * 1200 - rightW, right by 1/2 * 1200.
    expect(leftWidth()).toBe("300px");
    expect(rightWidth()).toBe("600px");

    width = 800;
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    // 800px area: left capped by 0.75 * 800 - 600 = 0, so the floor (1/4) holds;
    // right is then capped by 0.75 * 800 - 200 = 400.
    expect(leftWidth()).toBe("200px");
    expect(rightWidth()).toBe("400px");
  });

  it("drags a column wider and narrower within the bounds", async () => {
    stubColumnWidth(900);
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify({ leftW: 320, rightW: 420, leftOpen: true, rightOpen: false }));
    await renderBuilder();
    expect(leftWidth()).toBe("320px");

    // Two visible columns: [300, 600], so the stored 320 is already inside.
    drag("left", 320, 420);
    expect(leftWidth()).toBe("420px");

    drag("left", 320, 2000);
    expect(leftWidth()).toBe("600px");

    drag("left", 320, -2000);
    expect(leftWidth()).toBe("300px");
  });

  it("caps a side by what the chat column needs while both sides are open", async () => {
    stubColumnWidth(900);
    await renderBuilder();
    // Both open: the left may grow to 0.75 * 900 - rightW = 675 - 420 = 255.
    drag("left", 320, 2000);
    expect(leftWidth()).toBe("255px");
  });

  it("toggles a column on a press-and-release inside the drag threshold", async () => {
    stubColumnWidth(900);
    await renderBuilder();
    const handle = handleFor("left");
    fireEvent(handle, pointer("pointerdown", { clientX: 320, clientY: 300 }));
    fireEvent(window, pointer("pointermove", { clientX: 322, clientY: 301 }));
    fireEvent(window, pointer("pointerup", { clientX: 322, clientY: 301 }));
    expect(boardColumn()).toBeNull();
    expect(leftWidth()).toBe("auto");

    const edge = handleFor("left");
    fireEvent(edge, pointer("pointerdown", { clientX: 0, clientY: 300 }));
    fireEvent(window, pointer("pointerup", { clientX: 0, clientY: 300 }));
    expect(boardColumn()).not.toBeNull();
  });

  it("ignores non-primary pointers and non-left buttons", async () => {
    stubColumnWidth(900);
    await renderBuilder();
    const handle = handleFor("left");
    // Secondary button: no gesture, so the following up must not toggle either.
    fireEvent(handle, pointer("pointerdown", { clientX: 320, clientY: 300, button: 2 }));
    fireEvent(window, pointer("pointerup", { clientX: 320, clientY: 300, button: 2 }));
    expect(boardColumn()).not.toBeNull();

    // A second finger (not the primary pointer) is ignored as well.
    fireEvent(handle, pointer("pointerdown", { clientX: 320, clientY: 300, isPrimary: false }));
    fireEvent(window, pointer("pointerup", { clientX: 320, clientY: 300, isPrimary: false }));
    expect(boardColumn()).not.toBeNull();
  });

  it("ignores pointer events from another pointer id during a gesture", async () => {
    stubColumnWidth(900);
    // Two visible columns so the width the drag reaches is not already capped.
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify({ leftW: 320, rightW: 420, leftOpen: true, rightOpen: false }));
    await renderBuilder();
    const handle = handleFor("left");
    fireEvent(handle, pointer("pointerdown", { clientX: 320, clientY: 300, pointerId: 7 }));
    // A stray move from a different pointer must not resize anything.
    fireEvent(window, pointer("pointermove", { clientX: 500, clientY: 300, pointerId: 9 }));
    expect(leftWidth()).toBe("320px");
    fireEvent(window, pointer("pointermove", { clientX: 500, clientY: 300, pointerId: 7 }));
    expect(leftWidth()).toBe("500px");
    fireEvent(window, pointer("pointerup", { clientX: 500, clientY: 300, pointerId: 7 }));
  });

  it("settles silently when the gesture is cancelled", async () => {
    stubColumnWidth(900);
    await renderBuilder();
    const handle = handleFor("left");
    fireEvent(handle, pointer("pointerdown", { clientX: 320, clientY: 300 }));
    fireEvent(window, pointer("pointermove", { clientX: 900, clientY: 300 }));
    fireEvent(window, pointer("pointercancel", { clientX: 900, clientY: 300 }));
    // The interrupted drag keeps the width it reached and must not toggle later.
    expect(leftWidth()).toBe("255px");
    fireEvent(window, pointer("pointerup", { clientX: 900, clientY: 300 }));
    expect(boardColumn()).not.toBeNull();
  });

  it("resizes with the arrow keys and toggles with Enter or Space", async () => {
    stubColumnWidth(900);
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify({ leftW: 320, rightW: 420, leftOpen: true, rightOpen: false }));
    await renderBuilder();
    const handle = handleFor("left");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(leftWidth()).toBe("336px");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(leftWidth()).toBe("320px");
    // A key the handle does not own leaves the layout alone.
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(leftWidth()).toBe("320px");

    fireEvent.keyDown(handle, { key: " " });
    expect(boardColumn()).toBeNull();
    const edge = handleFor("left");
    fireEvent.keyDown(edge, { key: "Enter" });
    expect(boardColumn()).not.toBeNull();
  });

  it("keeps arrow keys inert on a collapsed column", async () => {
    stubColumnWidth(900);
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify({ leftW: 320, rightW: 420, leftOpen: false, rightOpen: true }));
    await renderBuilder();
    const edge = handleFor("left");
    fireEvent.keyDown(edge, { key: "ArrowRight" });
    // Still collapsed: a hidden column has no visible width to nudge.
    expect(boardColumn()).toBeNull();
    expect(leftWidth()).toBe("auto");
  });

  it("mirrors the right side: dragging outward widens, dragging inward narrows", async () => {
    stubColumnWidth(900);
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify({ leftW: 320, rightW: 420, leftOpen: false, rightOpen: true }));
    await renderBuilder();
    // Two visible columns (chat + trace): bounds [300, 600]. The handle sits on the
    // column's inner edge, so dragging it toward the chat column widens the trace.
    expect(rightWidth()).toBe("420px");
    drag("right", 500, 440);
    expect(rightWidth()).toBe("480px");
    drag("right", 500, 100);
    expect(rightWidth()).toBe("600px");
    drag("right", 500, 900);
    expect(rightWidth()).toBe("300px");
  });

  it("pulls a collapsed column open at the dragged width", async () => {
    stubColumnWidth(900);
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify({ leftW: 320, rightW: 420, leftOpen: false, rightOpen: true }));
    await renderBuilder();
    expect(boardColumn()).toBeNull();
    drag("left", 0, 900);
    // A collapsed column has no width to add to, so the drag distance is the width —
    // capped by the chat column's minimum share: 0.75 * 900 - 420 = 255.
    expect(boardColumn()).not.toBeNull();
    expect(leftWidth()).toBe("255px");
  });
});
