/**
 * @file message text tests
 * @description Locks visible-text extraction from heterogeneous message content.
 */

import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@agentprism/contracts";
import { messageText } from "../../src/context/message-text.js";

describe("messageText", () => {
  it("returns string content as-is", () => {
    expect(messageText({ role: "user", content: "hello" } as LlmMessage)).toBe("hello");
  });

  it("flattens block content to text", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    } as unknown as LlmMessage;
    expect(messageText(message)).toBe("ab");
  });
});
