/**
 * @file attachment names tests
 * @description Locks run-attachment name traversal rejection at the request boundary.
 */

import { describe, expect, it } from "vitest";
import {
  ArenaRunRequestSchema,
} from "@agentprism/contracts";

describe("run attachment name traversal rejection", () => {
  it("rejects absolute, parent, and separator-smuggled names at the boundary", () => {
    const base = { question: "q", dimension: "framework" as const };
    for (const name of ["../evil.txt", "/abs.txt", "a/../../b", "C:/win.txt", "a\\b.txt", "a//b.txt", ""]) {
      const parsed = ArenaRunRequestSchema.safeParse({
        ...base,
        attachments: [{ name, content: "x" }],
      });
      expect(parsed.success, name).toBe(false);
    }
  });

  it("accepts plain and nested relative names", () => {
    const parsed = ArenaRunRequestSchema.safeParse({
      question: "q",
      dimension: "framework" as const,
      attachments: [{ name: "notes/todo.txt", content: "x" }],
    });
    expect(parsed.success).toBe(true);
  });
});

