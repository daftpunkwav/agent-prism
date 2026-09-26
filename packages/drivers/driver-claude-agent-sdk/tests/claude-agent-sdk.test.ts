/**
 * @file claude agent sdk tests
 * @description Locks the Claude Agent SDK driver's transport, CLI discovery,
 *              MCP tool bridge, and its failure arc.
 *
 * Responsibilities:
 * - Cover Anthropic transport resolution and the subprocess environment
 * - Cover CLI discovery (override, global install, PATH, missing override)
 * - Cover MCP tool routing through the shared guarded path
 * - Pin the error arc for a column without an Anthropic endpoint
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { createBuiltinToolRegistry } from "@agentprism/tool-builtins";
import type { ArenaEvent, PipelineConfig, ToolDefinition } from "@agentprism/contracts";
import { ConfigurationError, PipelineConfigSchema } from "@agentprism/contracts";
import type { AgentExecutionContext } from "@agentprism/harness";
import { WorkspaceRegistry } from "@agentprism/runtime";
import { TokenTracker } from "@agentprism/telemetry";
import { ClaudeAgentSdkDriver } from "../src/claude-driver.js";
import { CLAUDE_CODE_PATH_ENV, resolveClaudeCodePath } from "../src/cli-path.js";
import { claudeSubprocessEnv, resolveClaudeTransport } from "../src/endpoint.js";
import { arenaAllowedToolIds, callArenaTool, createArenaMcpServer, mcpToolId } from "../src/mcp-tools.js";

/** Minimal Anthropic-shaped vendor instance (the fields ChatAnthropic exposes). */
function anthropicVendor(overrides: Record<string, unknown> = {}) {
  return {
    model: "glm-5.3-flash",
    apiKey: "secret-key",
    clientOptions: { baseURL: "https://ark.example/api/coding" },
    ...overrides,
  };
}

describe("resolveClaudeTransport", () => {
  it("reads the endpoint, credential and model off the configured model", () => {
    expect(resolveClaudeTransport(anthropicVendor(), "fallback")).toEqual({
      baseUrl: "https://ark.example/api/coding",
      apiKey: "secret-key",
      model: "glm-5.3-flash",
    });
  });

  it("falls back to the column model id when the vendor carries none", () => {
    expect(resolveClaudeTransport(anthropicVendor({ model: "" }), "col-model").model).toBe("col-model");
  });

  it("fails fast when the column is not an Anthropic endpoint", () => {
    // A ChatOpenAI-shaped vendor has no clientOptions/baseURL.
    expect(() => resolveClaudeTransport({ model: "m", apiKey: "k", configuration: {} }, "m")).toThrow(
      ConfigurationError,
    );
    expect(() => resolveClaudeTransport(null, "m")).toThrow(/anthropic_messages/);
  });

  it("fails fast when the credential is missing", () => {
    expect(() => resolveClaudeTransport(anthropicVendor({ apiKey: "" }), "m")).toThrow(/API Key/);
  });
});

describe("claudeSubprocessEnv", () => {
  it("points the CLI at the column endpoint and drops conflicting overrides", () => {
    const env = claudeSubprocessEnv(
      { baseUrl: "https://ark.example/api/coding", apiKey: "secret", model: "glm" },
      {
        PATH: "/usr/bin",
        ANTHROPIC_AUTH_TOKEN: "stale",
        CLAUDE_CODE_OAUTH_TOKEN: "stale",
        CLAUDE_CODE_USE_BEDROCK: "1",
      },
    );
    expect(env["ANTHROPIC_BASE_URL"]).toBe("https://ark.example/api/coding");
    expect(env["ANTHROPIC_API_KEY"]).toBe("secret");
    expect(env["ANTHROPIC_MODEL"]).toBe("glm");
    expect(env["ANTHROPIC_AUTH_TOKEN"]).toBeUndefined();
    expect(env["CLAUDE_CODE_OAUTH_TOKEN"]).toBeUndefined();
    expect(env["CLAUDE_CODE_USE_BEDROCK"]).toBeUndefined();
    // The SDK replaces the child environment outright, so PATH must be spread in.
    expect(env["PATH"]).toBe("/usr/bin");
  });
});

describe("resolveClaudeCodePath", () => {
  it("honors the explicit override", () => {
    const path = resolveClaudeCodePath({ [CLAUDE_CODE_PATH_ENV]: "/opt/claude/bin/claude" }, () => true);
    expect(path).toBe("/opt/claude/bin/claude");
  });

  it("fails fast when the override points at nothing", () => {
    expect(() => resolveClaudeCodePath({ [CLAUDE_CODE_PATH_ENV]: "/nope/claude" }, () => false)).toThrow(
      ConfigurationError,
    );
  });

  it("finds a global npm install before the .cmd shim", () => {
    const prefix = join("/home/user", ".npm-global");
    const wanted = join(prefix, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    const seen: string[] = [];
    const path = resolveClaudeCodePath({ PATH: prefix }, (candidate) => {
      seen.push(candidate);
      return candidate === wanted;
    });
    expect(path).toBe(wanted);
    expect(seen[0]).toBe(wanted);
  });

  it("falls back to a claude launcher directly on PATH", () => {
    const dir = join("/usr", "local", "bin");
    const wanted = join(dir, "claude");
    expect(resolveClaudeCodePath({ PATH: [join("/usr", "bin"), dir].join(delimiter) }, (c) => c === wanted)).toBe(
      wanted,
    );
  });

  it("returns undefined when nothing is installed (the SDK then tries its bundled binary)", () => {
    expect(resolveClaudeCodePath({ PATH: "/usr/bin" }, () => false)).toBeUndefined();
  });
});

describe("mcp tool bridge", () => {
  /** Registry-backed ToolAccess whose execute records calls. */
  function toolAccess(executed: string[]) {
    const registry = createBuiltinToolRegistry();
    return {
      registry,
      names: new Set(registry.listDefinitions().map((definition) => definition.name)),
      execute: async (name: string) => {
        executed.push(name);
        return { result: `${name} ran`, fileDiff: null, ok: true as const };
      },
    };
  }

  function definitionNamed(name: string): ToolDefinition {
    const definition = createBuiltinToolRegistry()
      .listDefinitions()
      .find((item) => item.name === name);
    if (definition === undefined) throw new Error(`missing builtin ${name}`);
    return definition;
  }

  it("names tools the way Claude Code addresses them", () => {
    expect(mcpToolId("read")).toBe("mcp__arena__read");
    expect(arenaAllowedToolIds(toolAccess([]))).toContain("mcp__arena__read");
  });

  it("registers one MCP tool per registry definition", () => {
    const tools = toolAccess([]);
    const server = createArenaMcpServer(tools, { question: "q", harness: "bare" });
    expect(server.name).toBe("arena");
    expect(tools.registry.listDefinitions().length).toBeGreaterThan(0);
  });

  it("runs a tool through the shared guarded path and returns its text", async () => {
    const executed: string[] = [];
    const tools = toolAccess(executed);
    const outcomes: string[] = [];
    const result = await callArenaTool(tools, definitionNamed("read"), { path: "a.txt" }, {
      question: "read a.txt",
      harness: "bare",
      priorToolNames: [],
      onOutcome: (name) => outcomes.push(name),
    });
    expect(executed).toEqual(["read"]);
    expect(outcomes).toEqual(["read"]);
    expect(result.content[0]).toEqual({ type: "text", text: "read ran" });
    expect(result.isError).toBeUndefined();
  });

  it("turns a thrown execute into recoverable error text", async () => {
    const registry = createBuiltinToolRegistry();
    const result = await callArenaTool(
      {
        registry,
        names: new Set(["read"]),
        execute: async () => {
          throw new Error("disk on fire");
        },
      },
      definitionNamed("read"),
      { path: "a.txt" },
      { question: "read a.txt", harness: "bare", priorToolNames: [] },
    );
    // The message is sanitized exactly like the shared tool batch path (the
    // client-facing text never echoes raw error detail), and isError is set so
    // the model can recover instead of the subprocess dying.
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: "Error: tool read failed: Error" });
  });

  it("blocks a drifted call the guard rejects and never executes it", async () => {
    const executed: string[] = [];
    const tools = toolAccess(executed);
    // Fixture mirrors the harness guard's own blocking case: a Latin question with
    // no lexical overlap against a long argument blob.
    const result = await callArenaTool(
      tools,
      definitionNamed("write"),
      { path: "notes.txt", content: "x".repeat(200) },
      {
        question: "What is the weather like today outside?",
        harness: "verify",
        priorToolNames: ["read"],
      },
    );
    expect(executed).toEqual([]);
    expect(result.isError).toBeUndefined();
    expect(JSON.stringify(result.content)).not.toContain("write ran");
  });
});

describe("ClaudeAgentSdkDriver", () => {
  function executionContext(
    llmVendor: unknown,
    overrides: Partial<AgentExecutionContext> = {},
  ): AgentExecutionContext & { cleanup: () => void } {
    const registry = createBuiltinToolRegistry();
    const config: PipelineConfig = PipelineConfigSchema.parse({ label: "col", harness: "bare" });
    const runsRoot = mkdtempSync(join(tmpdir(), "claude-sdk-driver-"));
    const workspace = new WorkspaceRegistry({ runsRoot, clock: { now: () => 1_700_000_000_000 } }).create("ws");
    const context = {
      identity: { agentId: "a1" } as AgentExecutionContext["identity"],
      config,
      question: "What is 2+2?",
      history: [],
      turn: 1,
      workspace,
      tracker: new TokenTracker(),
      clock: { now: () => 1_700_000_000_000 },
      rag: {} as AgentExecutionContext["rag"],
      llm: {} as AgentExecutionContext["llm"],
      llmVendor,
      tools: {
        registry,
        names: new Set(registry.listDefinitions().map((definition) => definition.name)),
        execute: async () => ({ result: "ok", fileDiff: null, ok: true }),
      },
      ...overrides,
    } as AgentExecutionContext & { cleanup: () => void };
    context.cleanup = () => rmSync(runsRoot, { recursive: true, force: true });
    return context;
  }

  it("declares the framework id and display name the registry and banner map use", () => {
    const driver = new ClaudeAgentSdkDriver();
    expect(driver.frameworkId).toBe("claude_agent_sdk");
    expect(driver.displayName).toBe("Claude Agent SDK");
  });

  it("converges a non-Anthropic column into error + unsuccessful complete", { timeout: 60_000 }, async () => {
    const driver = new ClaudeAgentSdkDriver();
    const context = executionContext({ model: "m", apiKey: "k", configuration: {} });
    try {
      const events: ArenaEvent[] = [];
      for await (const event of driver.run(context)) events.push(event);
      expect(events[0]?.type).toBe("token_update");
      const error = events.find((event) => event.type === "error");
      expect(error).toBeDefined();
      expect((error as ArenaEvent & { message: string }).message).toContain("anthropic_messages");
      const terminal = events.at(-1);
      expect(terminal?.type).toBe("complete");
      expect((terminal as ArenaEvent & { metrics: { success: boolean } }).metrics.success).toBe(false);
    } finally {
      context.cleanup();
    }
  });
});
