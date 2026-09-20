/**
 * @file require-chat-model tests
 * @description Covers the llmVendor chat-model narrowing guard.
 *
 * Responsibilities:
 * - Pin that an object with an invoke function passes through unchanged
 * - Pin the fail-closed error for null/primitive/missing-invoke vendors
 */

import { describe, expect, it } from "vitest";
import { requireChatModel } from "../src/require-chat-model.js";

describe("requireChatModel", () => {
  it("passes through a vendor object exposing invoke", () => {
    const model = { invoke: async () => ({}) };
    expect(requireChatModel(model)).toBe(model);
  });

  it("fails closed on null, primitives, and objects without invoke", () => {
    for (const bad of [null, undefined, "model", 42, {}]) {
      expect(() => requireChatModel(bad)).toThrow(/missing a usable ChatModel/);
    }
  });
});
