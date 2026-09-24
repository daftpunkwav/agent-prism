/**
 * @file context-assembly tests
 * @description Locks the example plugin strategies: pairing preservation and per-granularity omission.
 */

import { describe, expect, it } from "vitest";
import { contextAssemblyPlugins } from "../src/index.js";

const byId = new Map(contextAssemblyPlugins.map((p) => [p.id, p]));

const TRANSCRIPT = [
  { role: "user", content: "task" },
  {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "c1", name: "read", args: { path: "a.ts" } }],
  },
  { role: "tool", content: "export function a() {}", toolCallId: "c1", name: "read" },
  {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "c2", name: "write", args: { path: "b.ts", content: "x" } }],
  },
  { role: "tool", content: "Wrote: b.ts", toolCallId: "c2", name: "write" },
] as unknown as Parameters<(typeof contextAssemblyPlugins)[number]["apply"]>[0];

describe("context-assembly plugins", () => {
  it("exposes the three example strategies", () => {
    expect([...byId.keys()].sort()).toEqual(["assembly_all", "assembly_ops", "assembly_writes"]);
  });

  it("assembly_all keeps every tool result", () => {
    const out = byId.get("assembly_all")!.apply(TRANSCRIPT);
    expect(out).toEqual(TRANSCRIPT);
  });

  it("assembly_ops omits read results and keeps write results", () => {
    const out = byId.get("assembly_ops")!.apply(TRANSCRIPT);
    expect(out[2]?.content).toContain("omitted");
    expect(out[4]?.content).toBe("Wrote: b.ts");
    // Pairing is preserved: tool messages stay in place.
    expect(out.filter((m) => m.role === "tool")).toHaveLength(2);
  });

  it("assembly_writes keeps only mutating results", () => {
    const out = byId.get("assembly_writes")!.apply(TRANSCRIPT);
    expect(out[2]?.content).toContain("omitted");
    expect(out[4]?.content).toBe("Wrote: b.ts");
  });

  it("attributes parallel tool results by their own names, not the batch", () => {
    // One assistant turn requesting read+bash: the read result must be omitted
    // even though a sibling call in the same batch is kept.
    const parallel = [
      { role: "user", content: "task" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "c1", name: "read", args: {} },
          { id: "c2", name: "bash", args: {} },
        ],
      },
      { role: "tool", content: "file body", toolCallId: "c1", name: "read" },
      { role: "tool", content: "ran", toolCallId: "c2", name: "bash" },
    ] as unknown as Parameters<(typeof contextAssemblyPlugins)[number]["apply"]>[0];
    const out = byId.get("assembly_ops")!.apply(parallel);
    expect(out[2]?.content).toContain("omitted");
    expect(out[3]?.content).toBe("ran");
  });
});
