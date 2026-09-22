/**
 * @file crewai-driver test
 * @description Locks the sequential pipeline, hierarchical manager, and budgets.
 */
import { describe, expect, it, vi } from "vitest";
import type { ArenaEvent, LlmAdapter, LlmInvokeResult, LlmStreamPart, ToolDefinition } from "@agentprism/contracts";
import { extractAnswerFromEvents, PipelineConfigSchema } from "@agentprism/contracts";
import { RagStoreCache } from "@agentprism/harness";
import type { AgentExecutionContext } from "@agentprism/harness";
import { MapToolRegistry } from "@agentprism/tool-registry";
import { TokenTracker } from "@agentprism/telemetry";
import { SystemClock } from "@agentprism/runtime";
import { CrewAIDriver, taskTurnCapFor } from "../src/crewai-driver.js";
import { CREW_COMPLETE_KEYWORD, crewProcess, parseManagerAssignment } from "../src/crew.js";

/** Scripted LLM: queued invoke replies (manager) and stream replies (worker turns). */
function stubLlm(invokes: string[], streams: Array<{ text?: string; toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }> }>): LlmAdapter {
  let invokeAt = 0;
  let streamAt = 0;
  return {
    async invoke(): Promise<LlmInvokeResult> {
      const text = invokes[Math.min(invokeAt++, invokes.length - 1)] ?? "";
      return { text, toolCalls: [] };
    },
    async *stream(): AsyncGenerator<LlmStreamPart> {
      const reply = streams[Math.min(streamAt++, streams.length - 1)] ?? {};
      if (reply.text) yield { text: reply.text };
      if (reply.toolCalls) yield { toolCalls: reply.toolCalls };
    },
  };
}

function readTool(): ToolDefinition {
  return {
    name: "read",
    description: "read",
    jsonSchema: { type: "object", properties: {} },
    mutatesWorkspace: false,
    execute: async () => ({ result: "file content here", fileDiff: null, ok: true }),
  };
}

function contextWith(llm: LlmAdapter, reasoning: string = "react"): AgentExecutionContext {
  const registry = new MapToolRegistry();
  const tool = readTool();
  registry.register(tool);
  const names = new Set(["read"]);
  const workspace = { name: "ws", cwd: () => "/tmp/ws", fs: {} } as unknown as AgentExecutionContext["workspace"];
  return {
    identity: { agentId: "a", runId: "r" },
    config: PipelineConfigSchema.parse({ label: "col", harness: "bare", max_steps: 24, reasoning }),
    question: "write hi.txt",
    history: [],
    turn: 1,
    workspace,
    tracker: new TokenTracker({ contextWindow: 100000 }),
    clock: new SystemClock(),
    rag: new RagStoreCache(),
    llm,
    llmVendor: null,
    tools: {
      registry,
      names,
      execute: (name: string, args: Record<string, unknown>) => registry.execute(workspace, name, args, { authorizedNames: names }),
    },
  } as AgentExecutionContext;
}

async function collect(driver: CrewAIDriver, ctx: AgentExecutionContext): Promise<ArenaEvent[]> {
  const events: ArenaEvent[] = [];
  for await (const event of driver.run(ctx)) events.push(event);
  return events;
}

describe("CrewAIDriver sequential process", () => {
  it("runs research → implement → verify with task boundaries on reflect", async () => {
    const llm = stubLlm(
      [],
      [
        { text: "brief: workspace is empty" },
        { text: "writing the file", toolCalls: [{ id: "c1", name: "read", args: { path: "hi.txt" } }] },
        { text: "wrote the file" },
        { text: "final answer: artifact ready" },
      ],
    );
    const events = await collect(new CrewAIDriver(), contextWith(llm));
    const reflects = events.filter((event) => event.type === "reflect").map((event) => event.content);
    expect(reflects.some((content) => content.includes("task 1/3 → Researcher"))).toBe(true);
    expect(reflects.some((content) => content.includes("task 2/3 → Coding Engineer"))).toBe(true);
    expect(reflects.some((content) => content.includes("task 3/3 → Quality Reviewer"))).toBe(true);
    expect(reflects.some((content) => content.includes("output ready"))).toBe(true);
    const types = events.map((event) => event.type);
    expect(types).toContain("action");
    expect(types).toContain("observation");
    // The reviewer's final task output is the last thought — the answer.
    expect(extractAnswerFromEvents(events)).toBe("final answer: artifact ready");
    const complete = events.find((event) => event.type === "complete");
    expect(complete?.metrics?.success).toBe(true);
    expect(complete?.metrics?.tool_calls).toBe(1);
  });

  it("caps worker turns per task at exactly 18 LLM turns across the pipeline", async () => {
    const llm = stubLlm(
      [],
      [{ text: "still working", toolCalls: [{ id: "c1", name: "read", args: {} }] }],
    );
    const config = PipelineConfigSchema.parse({ label: "col", harness: "bare", max_steps: 60, reasoning: "react" });
    const ctx = contextWith(llm);
    ctx.config = config;
    const events = await collect(new CrewAIDriver(), ctx);
    const complete = events.find((event) => event.type === "complete");
    expect(complete?.metrics?.success).toBe(true);
    // 3 tasks × taskTurnCap 3 × 2 turns per runWorker (tool round + follow-up)
    // = 18. Only the per-task cap explains this number: uncapped, the workers
    // would keep calling tools until the 60-step budget.
    expect(complete?.metrics?.steps).toBe(18);
  });

  it("executes a follow-up turn's tool calls so the transcript never carries dangling tool calls", async () => {
    const llm = stubLlm(
      [],
      [
        { text: "checking", toolCalls: [{ id: "c1", name: "read", args: {} }] },
        { text: "one more look", toolCalls: [{ id: "c2", name: "read", args: {} }] },
        { text: "brief is done" },
        { text: "final answer: verified" },
      ],
    );
    const events = await collect(new CrewAIDriver(), contextWith(llm));
    // Both the opening turn's and the follow-up turn's read calls were executed:
    // an unexecuted follow-up tool call would leave an assistant message with
    // tool calls and no tool results, and the next LLM call would 400.
    const actions = events.filter((event) => event.type === "action");
    expect(actions).toHaveLength(2);
    const complete = events.find((event) => event.type === "complete");
    expect(complete?.metrics?.success).toBe(true);
    expect(complete?.metrics?.tool_calls).toBe(2);
  });

  it("emits temp/model/max_steps in the Step-0 config banner", async () => {
    const llm = stubLlm([], [{ text: "final: done" }]);
    const events = await collect(new CrewAIDriver(), contextWith(llm));
    const banner = events.find((event) => event.type === "thought");
    expect(banner?.content).toContain("temp=0");
    expect(banner?.content).toContain("model=");
    expect(banner?.content).toContain("max_steps=24");
  });
});

describe("CrewAIDriver hierarchical process", () => {
  it("delegates via the manager and runs the reviewer wrap-up on CREW_COMPLETE", async () => {
    vi.stubEnv("ARENA_CREWAI_PROCESS", "hierarchical");
    try {
      const llm = stubLlm(
        ['{"role":"coder","task":"implement it"}', CREW_COMPLETE_KEYWORD],
        [{ text: "did the work" }, { text: "final answer: crew done" }],
      );
      const events = await collect(new CrewAIDriver(), contextWith(llm));
      const reflects = events.filter((event) => event.type === "reflect").map((event) => event.content);
      expect(reflects.some((content) => content.includes("[CrewAI manager]"))).toBe(true);
      // CREW_COMPLETE still triggers the closing reviewer pass, whose output is the answer.
      expect(extractAnswerFromEvents(events)).toBe("final answer: crew done");
      const complete = events.find((event) => event.type === "complete");
      expect(complete?.metrics?.success).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("falls back to the final reviewer when the manager reply is unparsable", async () => {
    vi.stubEnv("ARENA_CREWAI_PROCESS", "hierarchical");
    try {
      const llm = stubLlm(
        ["huh"],
        [{ text: "final: all verified" }],
      );
      const events = await collect(new CrewAIDriver(), contextWith(llm));
      expect(extractAnswerFromEvents(events)).toBe("final: all verified");
      const complete = events.find((event) => event.type === "complete");
      expect(complete?.metrics?.success).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("crew primitives", () => {
  it("defaults to the sequential process and parses the env override", () => {
    expect(crewProcess({} as NodeJS.ProcessEnv)).toBe("sequential");
    expect(crewProcess({ ARENA_CREWAI_PROCESS: "hierarchical" } as NodeJS.ProcessEnv)).toBe("hierarchical");
    expect(crewProcess({ ARENA_CREWAI_PROCESS: "nonsense" } as NodeJS.ProcessEnv)).toBe("sequential");
  });

  it("parses manager delegations and completion", () => {
    expect(parseManagerAssignment('{"role":"coder","task":"build"}')).toEqual({
      role: "coder",
      task: "build",
      complete: false,
    });
    expect(parseManagerAssignment("we are CREW_COMPLETE")).toEqual({
      role: "reviewer",
      task: expect.any(String),
      complete: true,
    });
    expect(parseManagerAssignment('{"role":"boss"}')).toBeNull();
    expect(parseManagerAssignment("no json")).toBeNull();
  });

  it("grants reflexion one extra worker turn per task", () => {
    expect(taskTurnCapFor("react")).toBe(3);
    expect(taskTurnCapFor("reflexion")).toBe(4);
  });
});
