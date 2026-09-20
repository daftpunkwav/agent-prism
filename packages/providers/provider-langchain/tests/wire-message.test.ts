/**
 * @file wire message tests
 * @description Locks LLM wire message role mapping and reasoning extraction.
 */

import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { serializeWireMessage } from "../src/llm-trace.js";

describe("serializeWireMessage", () => {
  it("maps roles and extracts reasoning from additional kwargs", () => {
    const wire = serializeWireMessage(
      new AIMessage({
        content: "answer",
        additional_kwargs: { reasoning_content: "because..." },
      }),
    );
    expect(wire.role).toBe("assistant");
    expect(wire.content).toBe("answer");
    expect(wire.reasoning).toBe("because...");
  });

  it("extracts thinking blocks from array content", () => {
    const wire = serializeWireMessage(
      new AIMessage({
        content: [
          { type: "thinking", thinking: "step one" },
          { type: "text", text: "final" },
        ],
      }),
    );
    expect(wire.content).toBe("final");
    expect(wire.reasoning).toBe("step one");
  });

  it("maps tool and system roles", () => {
    const tool = serializeWireMessage(new ToolMessage({ content: "out", tool_call_id: "t1", name: "read" }));
    expect(tool.role).toBe("tool");
    expect(tool.tool_call_id).toBe("t1");
    expect(serializeWireMessage(new SystemMessage("sys")).role).toBe("system");
    expect(serializeWireMessage(new HumanMessage("hi")).role).toBe("user");
  });
});

