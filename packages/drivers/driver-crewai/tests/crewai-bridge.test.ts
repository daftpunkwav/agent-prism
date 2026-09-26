// @vitest-environment node
/**
 * @file crewai-bridge tests
 * @description Covers the host-side step budget on the crewai bridge: past the
 *              budget the llm handler answers with the wrap-up note instead of
 *              paying for another arena model call, and the run still lands on
 *              the bridge's final answer.
 */

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { ArenaEvent, LlmAdapter, LlmInvokeResult } from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import { RagStoreCache, type AgentExecutionContext } from "@agentprism/harness";
import { MapToolRegistry } from "@agentprism/tool-registry";
import { TokenTracker } from "@agentprism/telemetry";
import { SystemClock } from "@agentprism/runtime";
import { runCrewaiFrameworkBridge } from "../src/crewai-bridge.js";

const FAKE_BOOTSTRAP = fileURLToPath(new URL("./fake-bootstrap.mjs", import.meta.url));

function contextWith(llm: LlmAdapter): AgentExecutionContext {
  const registry = new MapToolRegistry();
  const names = new Set<string>();
  const workspace = { name: "ws", cwd: () => process.cwd(), fs: {} } as unknown as AgentExecutionContext["workspace"];
  return {
    identity: { agentId: "a", runId: "r" },
    // max_steps 2 → the bridge budget is 2: the third completion must be the note.
    config: PipelineConfigSchema.parse({ label: "col", harness: "bare", max_steps: 2 }),
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
      execute: async () => ({ result: "", fileDiff: null, ok: true }),
    },
  } as AgentExecutionContext;
}

describe("runCrewaiFrameworkBridge", () => {
  it("answers over-budget completions with the wrap-up note instead of another model call", async () => {
    let invokeCount = 0;
    const llm: LlmAdapter = {
      invoke: async (): Promise<LlmInvokeResult> => {
        invokeCount += 1;
        return { text: `model-${invokeCount}`, toolCalls: [] };
      },
      async *stream() {},
    };
    const events: ArenaEvent[] = [];
    for await (const event of runCrewaiFrameworkBridge({
      context: contextWith(llm),
      interpreter: process.execPath,
      bootstrapPath: FAKE_BOOTSTRAP,
    })) {
      events.push(event);
    }

    // Exactly two arena model calls; the third completion got the budget note,
    // which the bridge relays on the reflect channel (crewai maps all child
    // events there with the speaker prefix).
    expect(invokeCount).toBe(2);
    const note = events.find(
      (event) => event.type === "reflect" && event.content.includes("[arena] Step budget exhausted"),
    );
    expect(note).toBeDefined();
    const complete = events.at(-1);
    expect(complete?.type).toBe("complete");
    expect(complete?.metrics?.success).toBe(true);
  });
});
