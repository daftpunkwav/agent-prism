// @vitest-environment jsdom
/**
 * @file useColumnSessions tests
 * @description Locks per-column transcripts: turn pairs, clipping, budget trim, copy, and snapshots.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MAX_COLUMN_SESSION_MESSAGES, MAX_HISTORY_CHARS } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { deriveTurn, useColumnSessions } from "../src/app/arena/useColumnSessions.js";

afterEach(cleanup);

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLocale="en">{children}</I18nProvider>;
}

function renderSessions() {
  return renderHook(() => useColumnSessions(), { wrapper });
}

describe("deriveTurn", () => {
  it("derives the backend formula len//2 + 1", () => {
    expect(deriveTurn([])).toBe(1);
    expect(deriveTurn([{ role: "user", content: "q" }])).toBe(1);
    expect(deriveTurn([{ role: "user", content: "q" }, { role: "assistant", content: "a" }])).toBe(2);
    expect(deriveTurn(new Array(5).fill({ role: "user", content: "x" }))).toBe(3);
  });
});

describe("useColumnSessions", () => {
  it("pushes question/answer pairs and substitutes the no-reply text for empty answers", () => {
    const { result } = renderSessions();
    act(() => result.current.pushColumnTurn("Native", "q1", ""));
    act(() => result.current.pushColumnTurn("Native", "q2", "real answer"));
    const messages = result.current.sessions.Native!.messages;
    expect(messages).toHaveLength(4);
    expect(messages[0]).toEqual({ role: "user", content: "q1" });
    expect(messages[1]?.content).toBe(getCatalog("en").arena.history.noReply);
    expect(messages[3]?.content).toBe("real answer");
  });

  it("clips oversized answers to the 4000-char display cap", () => {
    const { result } = renderSessions();
    act(() => result.current.pushColumnTurn("Native", "q", "x".repeat(5000)));
    expect(result.current.sessions.Native!.messages[1]?.content).toHaveLength(4000);
  });

  it("trims history to the budget at a whole-turn boundary, keeping the latest turns", () => {
    const { result } = renderSessions();
    const question = "q".repeat(2000);
    const answer = "a".repeat(9000);
    for (const turn of ["1", "2", "3", "4"]) {
      act(() => result.current.pushColumnTurn("Native", `${question}${turn}`, answer));
    }
    // Answers are clipped to 4000 first: budget 24000-2001 fits turns 2-4 (18003
    // chars) but adding turn 1's answer would exceed it, so turn 1 drops as a pair.
    const messages = result.current.sessions.Native!.messages;
    expect(messages).toHaveLength(6);
    expect(messages[0]?.content.endsWith("2")).toBe(true);
    expect(messages[0]?.role).toBe("user");
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    expect(totalChars).toBeLessThan(MAX_HISTORY_CHARS);
  });

  it("caps transcripts at the backend's message ceiling, keeping whole latest turns", () => {
    const { result } = renderSessions();
    // Short turns never hit the char budget; the row cap is the binding limit.
    for (let turn = 1; turn <= MAX_COLUMN_SESSION_MESSAGES / 2 + 2; turn += 1) {
      act(() => result.current.pushColumnTurn("Native", `q${turn}`, `a${turn}`));
    }
    const messages = result.current.sessions.Native!.messages;
    expect(messages).toHaveLength(MAX_COLUMN_SESSION_MESSAGES);
    // The tail slice starts at an even index, so the oldest kept row is the user turn.
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("q3");
    expect(messages[messages.length - 1]?.content).toBe("a14");
  });

  it("remembers workspaces, ignoring blank values and unchanged rewrites", () => {
    const { result } = renderSessions();
    act(() => result.current.rememberWorkspace("Native", "ws-native"));
    expect(result.current.sessions.Native?.workspace).toBe("ws-native");
    const before = result.current.sessions.Native;
    act(() => result.current.rememberWorkspace("Native", "ws-native"));
    expect(result.current.sessions.Native).toBe(before);
    act(() => result.current.rememberWorkspace("Native", "   "));
    expect(result.current.sessions.Native?.workspace).toBe("ws-native");
  });

  it("copies one transcript onto targets on explicit action, keeping their workspaces", () => {
    const { result } = renderSessions();
    act(() => result.current.pushColumnTurn("Native", "q", "a"));
    act(() => result.current.rememberWorkspace("LangChain", "ws-lc"));
    act(() => result.current.copyTranscriptToAll("Native", ["LangChain"]));
    const copied = result.current.sessions.LangChain!.messages;
    expect(copied).toEqual(result.current.sessions.Native!.messages);
    expect(copied).not.toBe(result.current.sessions.Native!.messages);
    expect(result.current.sessions.LangChain!.workspace).toBe("ws-lc");
  });

  it("copy is a no-op for an unknown source", () => {
    const { result } = renderSessions();
    act(() => result.current.copyTranscriptToAll("ghost", ["Native"]));
    expect(result.current.sessions).toEqual({});
  });

  it("snapshots only non-empty sessions and omits unset workspaces", () => {
    const { result } = renderSessions();
    act(() => {
      result.current.pushColumnTurn("Native", "q", "a");
      result.current.rememberWorkspace("Native", "ws-native");
    });
    const snapshot = result.current.snapshotFor(["Native", "empty", "missing"]);
    expect(Object.keys(snapshot)).toEqual(["Native"]);
    expect(snapshot.Native).toEqual({ messages: result.current.sessions.Native!.messages, workspace: "ws-native" });
  });

  it("reset clears every session", () => {
    const { result } = renderSessions();
    act(() => result.current.pushColumnTurn("Native", "q", "a"));
    act(() => result.current.reset());
    expect(result.current.sessions).toEqual({});
  });
});
