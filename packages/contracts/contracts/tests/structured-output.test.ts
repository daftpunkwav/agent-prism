/**
 * @file structured-output test
 * @description Locks the final-answer schema shape and parse/validation behavior.
 */
import { describe, expect, it } from "vitest";
import {
  FINAL_ANSWER_JSON_SCHEMA,
  FINAL_ANSWER_RESPONSE_FORMAT,
  parseStructuredFinalAnswer,
  STRUCTURED_FINAL_KEYS,
} from "../src/structured-output.js";

describe("structured-output", () => {
  it("exposes a flat strict-mode-compatible schema with all keys required", () => {
    expect(FINAL_ANSWER_RESPONSE_FORMAT.name).toBe("final_answer");
    expect(FINAL_ANSWER_JSON_SCHEMA).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: [...STRUCTURED_FINAL_KEYS],
    });
    const properties = FINAL_ANSWER_JSON_SCHEMA.properties as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual([...STRUCTURED_FINAL_KEYS].sort());
  });

  it("parses a complete structured answer and canonicalizes it", () => {
    const raw = '```json\n{"plan":"did it","files":["a.py"],"how_to_run":"python a.py"}\n```';
    expect(parseStructuredFinalAnswer(raw)).toBe(
      '{"plan":"did it","files":["a.py"],"how_to_run":"python a.py"}',
    );
  });

  it("returns null when a required key is missing or empty", () => {
    expect(parseStructuredFinalAnswer('{"plan":"p","files":[],"how_to_run":""}')).toBeNull();
    expect(parseStructuredFinalAnswer('{"plan":"p","files":[]}')).toBeNull();
    expect(parseStructuredFinalAnswer("no json at all")).toBeNull();
    expect(parseStructuredFinalAnswer("{broken json")).toBeNull();
  });

  it("rejects non-string file entries", () => {
    expect(parseStructuredFinalAnswer('{"plan":"p","files":[1],"how_to_run":"r"}')).toBeNull();
  });
});
