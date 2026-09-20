/**
 * @file assembly-mentions test
 * @description Locks `@file` mention resolution inside prompt assembly.
 */
import { describe, expect, it } from "vitest";
import { PipelineConfigSchema } from "@agentprism/contracts";
import { RagStoreCache } from "../src/memory/rag.js";
import { MapToolRegistry } from "@agentprism/tool-registry";
import { TokenTracker } from "@agentprism/telemetry";
import { SystemClock } from "@agentprism/runtime";
import type { AgentExecutionContext } from "../src/execution-context.js";
import { buildSystemUser } from "../src/prompt/assembly.js";

function contextWith(question: string, files: Record<string, string>): AgentExecutionContext {
  const base = PipelineConfigSchema.parse({ label: "col", harness: "bare" });
  return {
    identity: { agentId: "a", runId: "r" },
    config: base,
    question,
    history: [],
    turn: 1,
    workspace: {
      name: "ws",
      cwd: () => "/tmp/ws",
      fs: {
        readFile: (path: string) => {
          const hit = files[path];
          if (hit === undefined) throw new Error("missing");
          return hit;
        },
        listFiles: (dir: string) => {
          if (dir === "." || dir === "") return Object.keys(files);
          throw new Error("not a directory");
        },
        exists: (path: string) => path in files,
      },
    } as unknown as AgentExecutionContext["workspace"],
    tracker: new TokenTracker({ contextWindow: 1000 }),
    clock: new SystemClock(),
    rag: new RagStoreCache(),
    llm: { invoke: async () => ({}) } as unknown as AgentExecutionContext["llm"],
    llmVendor: null,
    tools: { registry: new MapToolRegistry(), names: new Set(), execute: async () => ({ result: "", fileDiff: null, ok: true }) },
  };
}

describe("buildSystemUser mentions", () => {
  it("resolves @file mentions into fenced user context", () => {
    const { user } = buildSystemUser(contextWith("Summarize @notes.txt", { "notes.txt": "hello world" }));
    expect(user).toContain("[Referenced files]");
    expect(user).toContain("hello world");
  });

  it("marks missing mentions loudly and skips plain questions", () => {
    const missing = buildSystemUser(contextWith("Read @gone.txt", {}));
    expect(missing.user).toContain("(missing: missing)");
    const plain = buildSystemUser(contextWith("Just a question", { "notes.txt": "x" }));
    expect(plain.user).not.toContain("[Referenced files]");
  });
});
