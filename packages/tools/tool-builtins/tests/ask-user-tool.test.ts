/**
 * @file ask_user tool tests
 * @description Locks record-and-defer: questions persist, result never claims a human replied.
 */

import { describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";
import { askUserTool, liveAskUserTool, parseAskedQuestions, ASK_USER_STORE_FILE } from "@agentprism/tool-builtins";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-ask-"));
  return {
    name: "ws",
    root,
    cwd: () => root,
    fs: new ScopedFileSystem(root),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe("askUserTool", () => {
  it("records questions and defers with safest-assumption guidance", async () => {
    const ws = tempWorkspace();
    try {
      const out = await askUserTool.execute(ws, {
        questions: [{ id: "mode", header: "Choose Mode", question: "Fast or thorough?", options: ["fast", "thorough"] }],
      });
      expect(out.ok).toBe(true);
      expect(out.result).toContain("No human is available");
      expect(out.result).toContain("safest");
      expect(out.result).toContain("[mode]");
      expect(out.result).toContain("Fast or thorough?");
      const stored = JSON.parse(ws.fs.readFile(ASK_USER_STORE_FILE)) as unknown[];
      expect(stored).toHaveLength(1);
    } finally {
      ws.cleanup();
    }
  });

  it("defaults missing ids and appends across calls", async () => {
    const ws = tempWorkspace();
    try {
      await askUserTool.execute(ws, { questions: [{ question: "first?" }] });
      const out = await askUserTool.execute(ws, { questions: [{ question: "second?" }] });
      expect(out.ok).toBe(true);
      expect(out.result).toContain("[q1]");
      const stored = JSON.parse(ws.fs.readFile(ASK_USER_STORE_FILE)) as unknown[];
      expect(stored).toHaveLength(2);
    } finally {
      ws.cleanup();
    }
  });

  it("rejects bad input fail-closed without touching storage", async () => {
    const ws = tempWorkspace();
    try {
      for (const bad of [
        {},
        { questions: [] },
        { questions: "nope" },
        { questions: [{}] },
        { questions: [{ question: "" }] },
        { questions: [{ question: "ok?", options: ["", "b"] }] },
        { questions: Array.from({ length: 6 }, (_, i) => ({ question: `q${i}?` })) },
      ]) {
        const out = await askUserTool.execute(ws, bad as Record<string, unknown>);
        expect(out.ok).toBe(false);
        expect(out.code).toBe("workspace_error");
      }
      expect(ws.fs.exists(ASK_USER_STORE_FILE)).toBe(false);
    } finally {
      ws.cleanup();
    }
  });
});

describe("liveAskUserTool", () => {
  it("returns the human's answers inline and records them", async () => {
    const ws = tempWorkspace();
    try {
      const tool = liveAskUserTool(async (questions) => ({
        answered: true,
        answers: questions.map((question) => ({ id: question.id, answer: `answer:${question.id}` })),
      }));
      const out = await tool.execute(ws, {
        questions: [
          { id: "mode", question: "Fast or thorough?", options: ["fast", "thorough"] },
          { question: "second?" },
        ],
      });
      expect(out.ok).toBe(true);
      expect(out.result).toContain("The human answered inline");
      expect(out.result).toContain("[mode] answer:mode");
      // Missing ids fall back to position-based defaults (second question -> q2).
      expect(out.result).toContain("[q2] answer:q2");
      const stored = JSON.parse(ws.fs.readFile(ASK_USER_STORE_FILE)) as Array<{ answers?: unknown[] }>;
      expect(stored[0]?.answers).toHaveLength(2);
    } finally {
      ws.cleanup();
    }
  });

  it("degrades to the headless defer text when the human never answers", async () => {
    const ws = tempWorkspace();
    try {
      const tool = liveAskUserTool(async () => ({ answered: false, answers: [] }));
      const out = await tool.execute(ws, { questions: [{ id: "mode", question: "Fast or thorough?" }] });
      expect(out.ok).toBe(true);
      expect(out.result).toContain("No human is available");
      expect(out.result).toContain("safest");
      const stored = JSON.parse(ws.fs.readFile(ASK_USER_STORE_FILE)) as unknown[];
      expect(stored).toHaveLength(1);
    } finally {
      ws.cleanup();
    }
  });

  it("skipped questions are labeled so the model proceeds on assumptions", async () => {
    const ws = tempWorkspace();
    try {
      const tool = liveAskUserTool(async () => ({ answered: true, answers: [{ id: "mode", answer: "" }] }));
      const out = await tool.execute(ws, { questions: [{ id: "mode", question: "Fast or thorough?" }] });
      expect(out.ok).toBe(true);
      expect(out.result).toContain("[mode] (skipped");
    } finally {
      ws.cleanup();
    }
  });

  it("validates args fail-closed before reaching the human channel", async () => {
    const ws = tempWorkspace();
    try {
      let asked = 0;
      const tool = liveAskUserTool(async () => {
        asked += 1;
        return { answered: false, answers: [] };
      });
      const out = await tool.execute(ws, { questions: [{ question: "" }] });
      expect(out.ok).toBe(false);
      expect(out.code).toBe("workspace_error");
      expect(asked).toBe(0);
    } finally {
      ws.cleanup();
    }
  });
});

describe("parseAskedQuestions id uniqueness", () => {
  it("rejects duplicate ids fail-closed (interactive settle keys answers by id)", () => {
    const parsed = parseAskedQuestions({
      questions: [
        { id: "mode", question: "first?" },
        { id: "mode", question: "second?" },
      ],
    });
    expect("error" in parsed && parsed.error).toContain("unique");
  });

  it("rejects a default id colliding with an explicit id", () => {
    const parsed = parseAskedQuestions({
      questions: [{ question: "gets q1" }, { id: "q1", question: "explicit q1" }],
    });
    expect("error" in parsed && parsed.error).toContain("unique");
  });

  it("accepts distinct ids", () => {
    const parsed = parseAskedQuestions({
      questions: [{ id: "a", question: "first?" }, { question: "second?" }],
    });
    expect(parsed).toEqual({
      questions: [
        { id: "a", header: "", question: "first?", options: [] },
        { id: "q2", header: "", question: "second?", options: [] },
      ],
    });
  });

  it("accepts uppercased keys (model-cased QUESTIONS/ID/HEADER/QUESTION/OPTIONS)", () => {
    const parsed = parseAskedQuestions({
      QUESTIONS: [{ ID: "TEST-1", HEADER: "工具测试", QUESTION: "这是一个测试问题?", OPTIONS: ["A", "B"] }],
    } as unknown as Record<string, unknown>);
    expect("questions" in parsed).toBe(true);
    if ("questions" in parsed) {
      expect(parsed.questions).toEqual([
        { id: "TEST-1", header: "工具测试", question: "这是一个测试问题?", options: ["A", "B"] },
      ]);
    }
  });

  it("flattens double-wrapped options (the LangChain options[0]-array failure)", () => {
    const parsed = parseAskedQuestions({
      questions: [{ id: "t", question: "可用?", options: [["可用", "不可用"]] }],
    });
    expect(parsed).toEqual({
      questions: [{ id: "t", header: "", question: "可用?", options: ["可用", "不可用"] }],
    });
  });

  it("accepts an input-wrapped stringified batch (observed LangChain shape)", () => {
    const inner = JSON.stringify({
      questions: [{ id: "test1", question: "这是一次可用性测试?", options: ["收到", "未收到"] }],
    });
    const parsed = parseAskedQuestions({ input: inner });
    expect(parsed).toEqual({
      questions: [{ id: "test1", header: "", question: "这是一次可用性测试?", options: ["收到", "未收到"] }],
    });
  });

  it("keeps caps and strict element rules enforced around the nesting tolerance", () => {
    const tooMany = parseAskedQuestions({
      questions: [{ question: "选?", options: [["1", "2", "3", "4", "5", "6", "7"]] }],
    });
    expect("error" in tooMany).toBe(true);
    const emptyProvided = parseAskedQuestions({ questions: [{ question: "选?", options: ["", " "] }] });
    expect("error" in emptyProvided).toBe(true);
    const notArray = parseAskedQuestions({ questions: [{ question: "选?", options: "a, b" }] });
    expect("error" in notArray).toBe(true);
  });
});
