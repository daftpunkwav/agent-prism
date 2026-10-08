// @vitest-environment jsdom
/**
 * @file use arena attachments tests
 * @description Locks the composer attachment hook: schema-mirrored validation and stale-read invalidation.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useArenaAttachments } from "../src/app/arena/useArenaAttachments.js";
import type { useT } from "../src/i18n/useT.js";

type TFn = ReturnType<typeof useT>;
const t = ((key: string) => key) as unknown as TFn;

afterEach(() => {
  vi.restoreAllMocks();
});

function makeFile(name: string, size = 10, content = "hello"): File {
  return { name, size, text: async () => content } as unknown as File;
}

/** Flushes the microtasks a resolved read still has to walk before it settles. */
async function flushReads(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("useArenaAttachments", () => {
  it("adds a picked file as an attachment", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useArenaAttachments(onError, t));
    await act(async () => {
      await result.current.handleAttachFiles([makeFile("notes.txt")]);
    });
    expect(result.current.attachments).toEqual([{ name: "notes.txt", content: "hello" }]);
    // Only the error-banner reset, never an error string.
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(null);
  });

  it("rejects names beyond the server schema limit before adding", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useArenaAttachments(onError, t));
    await act(async () => {
      await result.current.handleAttachFiles([makeFile("x".repeat(201))]);
    });
    expect(onError).toHaveBeenCalledWith("arena.attach.nameTooLong");
    expect(result.current.attachments).toEqual([]);
  });

  it("discards a read still pending when the list is cleared", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useArenaAttachments(onError, t));
    let release: (value: string) => void = () => {};
    const slow = {
      name: "slow.txt",
      size: 10,
      text: () => new Promise<string>((resolve) => {
        release = resolve;
      }),
    } as unknown as File;
    act(() => {
      void result.current.handleAttachFiles([slow]);
    });
    act(() => {
      result.current.clearAttachments();
    });
    release("late content");
    await flushReads();
    expect(result.current.attachments).toEqual([]);
  });

  it("discards a read still pending when the file is removed", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useArenaAttachments(onError, t));
    let release: (value: string) => void = () => {};
    const slow = {
      name: "slow.txt",
      size: 10,
      text: () => new Promise<string>((resolve) => {
        release = resolve;
      }),
    } as unknown as File;
    act(() => {
      void result.current.handleAttachFiles([slow]);
    });
    act(() => {
      result.current.handleRemoveAttachment("slow.txt");
    });
    release("late content");
    await flushReads();
    expect(result.current.attachments).toEqual([]);
  });

  it("keeps later files of a batch alive when an earlier file is discarded for size", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useArenaAttachments(onError, t));
    const oversized = makeFile("big.bin", 64 * 1024 + 1);
    const normal = makeFile("small.txt");
    await act(async () => {
      await result.current.handleAttachFiles([oversized, normal]);
    });
    expect(onError).toHaveBeenCalledWith("arena.attach.tooLarge");
    expect(result.current.attachments).toEqual([{ name: "small.txt", content: "hello" }]);
  });
});
