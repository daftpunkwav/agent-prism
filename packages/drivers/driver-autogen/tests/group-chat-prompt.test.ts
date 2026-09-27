/**
 * @file autogen group-chat prompt tests
 * @description Locks the speaker-selection note the AutoGen column sends per round.
 *
 * Responsibilities:
 * - Pin that the roster names every participant with its description
 * - Pin the "chat start" wording and the terse-reply instruction the parser relies on
 *
 * The prompt is public surface of this driver package (the group-chat primitives are
 * re-exported for hosts), and its shape is load-bearing: `parseSpeakerSelection`
 * only understands a bare name, so the instruction has to say so.
 */

import { describe, expect, it } from "vitest";
import { speakerSelectionPrompt } from "@agentprism/driver-autogen";

describe("speakerSelectionPrompt", () => {
  it("lists every participant with its description", () => {
    const prompt = speakerSelectionPrompt("coder");
    for (const name of ["coder", "reviewer"]) {
      expect(prompt).toContain(name);
    }
    expect(prompt).toContain("makes progress with tool calls");
    expect(prompt).toContain("reviews the transcript");
  });

  it("names the last speaker, or the chat start when there is none", () => {
    expect(speakerSelectionPrompt("reviewer")).toContain("Last speaker: reviewer");
    expect(speakerSelectionPrompt(null)).toContain("Last speaker: none (chat start)");
  });

  it("asks for the bare name the selection parser expects", () => {
    expect(speakerSelectionPrompt("coder")).toContain("Reply with just the name");
  });
});
