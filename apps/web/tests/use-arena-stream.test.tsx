// @vitest-environment jsdom
/**
 * @file useArenaStream tests
 * @description Locks the SSE consumption hook: event merge, settle, abort, ask-user windows, per-column stop.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ArenaEvent, JudgeResult } from "@agentprism/client";
import { answerArenaQuestion, stopArenaColumn, streamArenaRun } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { useArenaStream, type RunOptions } from "../src/app/arena/useArenaStream.js";

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  streamArenaRun: vi.fn(),
  stopArenaColumn: vi.fn(async () => undefined),
  answerArenaQuestion: vi.fn(async () => undefined),
}));

const streamMock = vi.mocked(streamArenaRun);
const stopColumnMock = vi.mocked(stopArenaColumn);
const answerMock = vi.mocked(answerArenaQuestion);

type StreamParams = Parameters<typeof streamArenaRun>[0];

/** Installs a stream double the test drives by hand: emit events, settle, or abort. */
let emit: ((event: ArenaEvent) => void) | undefined;
let settle: (() => void) | undefined;
function scriptStream() {
  streamMock.mockImplementation(
    (params: StreamParams) =>
      new Promise<void>((resolve, reject) => {
        emit = params.onEvent;
        settle = resolve;
        params.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })),
        );
      }),
  );
}

afterEach(() => {
  cleanup();
  // restoreAllMocks no longer resets vi.fn() history in Vitest 4.
  vi.clearAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLocale="en">{children}</I18nProvider>;
}

function renderStream() {
  return renderHook(() => useArenaStream(), { wrapper });
}

function runOptions(overrides?: Partial<RunOptions>): RunOptions {
  return {
    question: "q",
    dimension: "framework",
    selections: ["native"],
    columnSessions: {},
    preserveColumns: [{ label: "Native", frameworkId: "native" }],
    ...overrides,
  };
}

const METRICS = {
  input_tokens: 10,
  output_tokens: 5,
  total_tokens: 15,
  context_window: 1000,
  max_input_tokens: 900,
  max_output_tokens: 100,
  context_usage_pct: 1.5,
  input_usage_pct: 1.1,
};

describe("useArenaStream", () => {
  it("merges events into their column and settles the run when every column completes", async () => {
    scriptStream();
    const { result } = renderStream();
    let run!: Promise<{ aborted: boolean; failed: boolean }>;
    await act(async () => {
      run = result.current.run(runOptions());
    });
    expect(result.current.running).toBe(true);

    act(() => emit?.({ type: "step_start", pipeline: "Native", turn: 1 } as unknown as ArenaEvent));
    act(() =>
      emit?.({
        type: "token_update",
        pipeline: "Native",
        token_stats: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
        workspace: "ws-native",
      } as unknown as ArenaEvent),
    );
    act(() =>
      emit?.({ type: "complete", pipeline: "Native", metrics: METRICS } as unknown as ArenaEvent),
    );
    await act(async () => {
      settle?.();
      await run;
    });
    expect(result.current.running).toBe(false);
    const column = result.current.columns.Native!;
    expect(column.workspace).toBe("ws-native");
    expect(column.metrics).toEqual(METRICS);
    // complete falls back to deriving token stats from the metrics.
    expect(column.tokenStats?.total_tokens).toBe(15);
    // complete events stay out of the rendered timeline.
    expect(column.events.some((event) => event.type === "complete")).toBe(false);
    expect(column.events.some((event) => event.type === "step_start")).toBe(true);
    await expect(run).resolves.toEqual({ aborted: false, failed: false });
  });

  it("stops the run and strips the current turn on a system-level error", async () => {
    scriptStream();
    const onSystemError = vi.fn();
    const { result } = renderStream();
    let run!: Promise<{ aborted: boolean; failed: boolean }>;
    await act(async () => {
      run = result.current.run(runOptions(), onSystemError);
    });
    act(() => emit?.({ type: "step_start", pipeline: "Native", turn: 1 } as unknown as ArenaEvent));
    act(() => emit?.({ type: "error", pipeline: "system", message: "route down" } as unknown as ArenaEvent));
    await act(async () => {});
    expect(onSystemError).toHaveBeenCalledOnce();
    expect(result.current.error).toBe("route down");
    expect(result.current.running).toBe(false);
    expect(result.current.columns.Native!.events).toHaveLength(0);
    await waitFor(() => expect(run).resolves.toEqual({ aborted: true, failed: false }));
  });

  it("keeps the request error message when the stream never opens", async () => {
    // A rejected request (e.g. 422) throws before any column settles: the
    // disconnect verdict must not overwrite the real error message.
    streamMock.mockRejectedValue(new Error("HTTP 422: baseline field invalid"));
    const { result } = renderStream();
    let run!: Promise<{ aborted: boolean; failed: boolean }>;
    await act(async () => {
      run = result.current.run(runOptions());
    });
    await expect(run).resolves.toEqual({ aborted: false, failed: true });
    expect(result.current.error).toBe("HTTP 422: baseline field invalid");
  });

  it("parses the comparison report and leaves a trace on malformed JSON", async () => {    scriptStream();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderStream();
    let run!: Promise<unknown>;
    await act(async () => {
      run = result.current.run(runOptions());
    });
    act(() => emit?.({ type: "report", pipeline: "Native", content: '{"verdict":"good"}' } as unknown as ArenaEvent));
    expect(result.current.comparisonReport).toEqual({ verdict: "good" });
    act(() => emit?.({ type: "report", pipeline: "Native", content: "not-json" } as unknown as ArenaEvent));
    expect(result.current.comparisonReport).toEqual({ verdict: "good" });
    expect(warn).toHaveBeenCalledOnce();
    await act(async () => {
      settle?.();
      await run;
    });
  });

  it("opens one ask window per asking column and closes it on the observation", async () => {
    scriptStream();
    const { result } = renderStream();
    let run!: Promise<unknown>;
    await act(async () => {
      run = result.current.run(runOptions());
    });
    act(() =>
      emit?.({
        type: "action",
        pipeline: "Native",
        agentId: "agent-1",
        tool: "ask_user",
        args: { questions: [{ id: "q1", header: "Confirm", question: "Proceed?", options: ["yes"] }] },
      } as unknown as ArenaEvent),
    );
    expect(result.current.pendingAsks["agent-1"]).toMatchObject({ sourceLabel: "Native", agentId: "agent-1" });
    act(() =>
      emit?.({ type: "observation", pipeline: "Native", agentId: "agent-1" } as unknown as ArenaEvent),
    );
    expect(result.current.pendingAsks).toEqual({});
    await act(async () => {
      settle?.();
      await run;
    });
  });

  it("bumps the workspace refresh token on file_diff", async () => {
    scriptStream();
    const { result } = renderStream();
    let run!: Promise<unknown>;
    await act(async () => {
      run = result.current.run(runOptions());
    });
    act(() => emit?.({ type: "file_diff", pipeline: "Native" } as unknown as ArenaEvent));
    expect(result.current.workspaceRefreshToken).toBe(1);
    await act(async () => {
      settle?.();
      await run;
    });
  });

  it("stops one column through its agent id and settles the stopping flag on terminal events", async () => {
    scriptStream();
    const { result } = renderStream();
    let run!: Promise<unknown>;
    await act(async () => {
      run = result.current.run(runOptions());
    });
    // Unknown labels cannot stop.
    await act(async () => {
      expect(await result.current.stopColumn("Ghost")).toBe(false);
    });
    expect(stopColumnMock).not.toHaveBeenCalled();
    act(() =>
      emit?.({ type: "step_start", pipeline: "Native", agentId: "agent-1", turn: 1 } as unknown as ArenaEvent),
    );
    await act(async () => {
      expect(await result.current.stopColumn("Native")).toBe(true);
    });
    expect(stopColumnMock).toHaveBeenCalledWith("agent-1");
    expect(result.current.stoppingLabels.Native).toBe(true);
    act(() => emit?.({ type: "complete", pipeline: "Native", metrics: METRICS } as unknown as ArenaEvent));
    expect(result.current.stoppingLabels).toEqual({});
    await act(async () => {
      settle?.();
      await run;
    });
  });

  it("keeps other columns' stopping flags when the stop call fails with a non-404 error", async () => {
    scriptStream();
    stopColumnMock.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderStream();
    let run!: Promise<unknown>;
    await act(async () => {
      run = result.current.run(runOptions());
    });
    act(() =>
      emit?.({ type: "step_start", pipeline: "Native", agentId: "agent-1", turn: 1 } as unknown as ArenaEvent),
    );
    await act(async () => {
      expect(await result.current.stopColumn("Native")).toBe(false);
    });
    expect(result.current.error).toBe("network down");
    expect(result.current.stoppingLabels).toEqual({});
    await act(async () => {
      settle?.();
      await run;
    });
  });

  it("cancelRun aborts the stream, strips the turn, and clears transient state", async () => {
    scriptStream();
    const { result } = renderStream();
    let run!: Promise<{ aborted: boolean; failed: boolean }>;
    await act(async () => {
      run = result.current.run(runOptions());
    });
    act(() => emit?.({ type: "step_start", pipeline: "Native", turn: 1 } as unknown as ArenaEvent));
    await act(async () => {
      result.current.cancelRun();
    });
    expect(result.current.running).toBe(false);
    expect(result.current.columns.Native!.events).toHaveLength(0);
    await expect(run).resolves.toEqual({ aborted: true, failed: false });
  });

  it("classifies user stops as non-failures", () => {
    const { result } = renderStream();
    expect(result.current.isStoppedMessage("Column stopped by user request")).toBe(true);
    expect(result.current.isStoppedMessage("disk on fire")).toBe(false);
    expect(result.current.isStoppedMessage(undefined)).toBe(false);
  });

  it("writes judge results back into the matching column only", async () => {
    scriptStream();
    const { result } = renderStream();
    let run!: Promise<unknown>;
    await act(async () => {
      run = result.current.run(runOptions({
        preserveColumns: [
          { label: "Native", frameworkId: "native" },
          { label: "LangChain", frameworkId: "langchain" },
        ],
      }));
    });
    await act(async () => {
      settle?.();
      await run;
    });
    const judge = { verdict: "pass" } as unknown as JudgeResult;
    act(() => result.current.applyJudgeResults({ Native: judge }));
    expect(result.current.columns.Native?.judge).toEqual(judge);
    expect(result.current.columns.LangChain?.judge).toBeUndefined();
  });

  it("answers a pending ask and reports submit failures through the error state", async () => {
    const { result } = renderStream();
    expect(await act(async () => result.current.answerAsk("", "q1", "yes"))).toBe(false);
    expect(answerMock).not.toHaveBeenCalled();

    await act(async () => {
      expect(await result.current.answerAsk("agent-1", "q1", "yes")).toBe(true);
    });
    expect(answerMock).toHaveBeenCalledWith("agent-1", "q1", "yes");

    answerMock.mockRejectedValueOnce(new Error("gone"));
    await act(async () => {
      expect(await result.current.answerAsk("agent-1", "q1", "yes")).toBe(false);
    });
    expect(result.current.error).toBe(getCatalog("en").common.askSubmitError);
  });

  it("resetColumns clears columns, report, and error", async () => {
    scriptStream();
    const { result } = renderStream();
    let run!: Promise<unknown>;
    await act(async () => {
      run = result.current.run(runOptions());
    });
    act(() => emit?.({ type: "step_start", pipeline: "Native", turn: 1 } as unknown as ArenaEvent));
    await act(async () => {
      settle?.();
      await run;
    });
    act(() => result.current.resetColumns());
    expect(result.current.columns).toEqual({});
    expect(result.current.comparisonReport).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
