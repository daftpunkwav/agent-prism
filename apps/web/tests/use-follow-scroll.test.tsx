// @vitest-environment jsdom
/**
 * @file useFollowScroll tests
 * @description Locks streaming auto-follow: growth never detaches, only an
 * upward user scroll does, and scrolling back to the tail re-arms following.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFollowScroll } from "../src/hooks/useFollowScroll";

type ScrollBox = HTMLElement & { scrollTop: number };

/** Installs readable/writable layout numbers driven by the shared layout state. */
function mockScrollBoxInto(node: HTMLElement, state: { scrollTop: number; scrollHeight: number; clientHeight: number }): ScrollBox {
  Object.defineProperty(node, "scrollHeight", { configurable: true, get: () => state.scrollHeight });
  Object.defineProperty(node, "clientHeight", { configurable: true, get: () => state.clientHeight });
  Object.defineProperty(node, "scrollTop", {
    configurable: true,
    get: () => state.scrollTop,
    set: (value: number) => {
      state.scrollTop = Math.max(0, Math.min(value, state.scrollHeight - state.clientHeight));
    },
  });
  return node as ScrollBox;
}

function setup() {
  const host = document.createElement("div");
  const layout = { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 };
  const box = mockScrollBoxInto(host, layout);
  // signal bumps re-run the follow effect, standing in for streamed batches.
  const hook = renderHook(({ signal }: { signal: number }) => useFollowScroll([signal]), {
    initialProps: { signal: 0 },
  });
  act(() => {
    (hook.result.current.scrollRef as unknown as { current: HTMLElement }).current = host;
  });
  let signal = 0;
  const stream = () => {
    signal += 1;
    act(() => void hook.rerender({ signal }));
  };
  act(() => void stream()); // first pin with the ref attached
  // The hook is wired to the container via onScroll in real components; tests
  // invoke the handler directly after mutating the mocked layout numbers.
  const fire = () => act(() => void hook.result.current.handleScroll());
  const grow = (height: number) => {
    layout.scrollHeight = height;
  };
  return { box, hook, fire, grow, stream };
}

describe("useFollowScroll", () => {
  it("content growth fires scroll events but never detaches following", () => {
    const { box, fire, grow, hook, stream } = setup();
    grow(1600);
    fire();
    expect(hook.result.current.detached).toBe(false);
    // A follow write landed at the old bottom; the next growth batch re-pins.
    grow(2000);
    stream();
    expect(hook.result.current.detached).toBe(false);
    expect(box.scrollTop).toBe(2000 - 500);
  });

  it("an upward user scroll detaches and the jump button state follows", () => {
    const { box, fire, grow, hook, stream } = setup();
    grow(1600);
    fire();
    act(() => {
      box.scrollTop = 300; // user wheels up
    });
    fire();
    expect(hook.result.current.detached).toBe(true);
    // Growth no longer re-pins a detached column.
    grow(2400);
    stream();
    expect(box.scrollTop).toBe(300);
  });

  it("scrolling back to the tail re-arms following", () => {
    const { box, fire, grow, hook, stream } = setup();
    grow(1600);
    fire();
    act(() => {
      box.scrollTop = 300;
    });
    fire();
    expect(hook.result.current.detached).toBe(true);
    act(() => {
      box.scrollTop = 1600 - 500; // user returns to the tail
    });
    fire();
    expect(hook.result.current.detached).toBe(false);
    grow(2200);
    stream();
    expect(box.scrollTop).toBe(2200 - 500);
  });

  it("jumpToBottom re-pins immediately and clears the detach state", () => {
    const { box, fire, grow, hook } = setup();
    grow(1600);
    fire();
    act(() => {
      box.scrollTop = 200;
    });
    fire();
    act(() => void hook.result.current.jumpToBottom());
    expect(hook.result.current.detached).toBe(false);
    expect(box.scrollTop).toBe(1600 - 500);
  });
});
