/**
 * @file memory-service-adapter test
 * @description Locks port forwarding and the recallAll combination over real stores.
 */
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryServiceAdapter } from "../src/memory-service-adapter.js";
import { EpisodicMemory } from "@agentprism/memory-episodic";
import { SemanticMemory } from "@agentprism/memory-semantic";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop() as string;
    rmSync(root, { recursive: true, force: true });
  }
});

function adapterIn(root: string): MemoryServiceAdapter {
  return new MemoryServiceAdapter({
    episodic: new EpisodicMemory({ filePath: join(root, "episodic.json") }),
    semantic: new SemanticMemory({ filePath: join(root, "semantic.json") }),
  });
}

describe("MemoryServiceAdapter", () => {
  it("records and recalls episodic entries through the port", async () => {
    const root = mkdtempSync(join(tmpdir(), "memory-service-"));
    roots.push(root);
    const service = adapterIn(root);
    await service.recordEpisodic({
      task: "write a factorial script with node",
      framework: "native",
      model: "test",
      success: true,
      keyActions: ["write", "bash"],
      lessons: "Ran the script to verify.",
      workspaceTag: "",
    });
    const hits = await service.recallEpisodic("factorial script", { limit: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.task).toContain("factorial");
    expect(hits[0]?.id).toMatch(/^ep-/);
  });

  it("records and recalls semantic facts through the port", async () => {
    const root = mkdtempSync(join(tmpdir(), "memory-service-"));
    roots.push(root);
    const service = adapterIn(root);
    await service.recordSemantic({
      subject: "project",
      predicate: "uses",
      object: "pnpm",
      confidence: 0.9,
      validFrom: 0,
      source: "test",
    });
    const facts = await service.recallSemantic("pnpm", { limit: 1 });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.object).toBe("pnpm");
    expect(facts[0]?.id).toMatch(/^sem-/);
  });

  it("combines both stores in recallAll", async () => {
    const root = mkdtempSync(join(tmpdir(), "memory-service-"));
    roots.push(root);
    const service = adapterIn(root);
    await service.recordEpisodic({
      task: "factorial task",
      framework: "native",
      model: "test",
      success: true,
      keyActions: [],
      lessons: "",
      workspaceTag: "",
    });
    await service.recordSemantic({
      subject: "workspace",
      predicate: "runs",
      object: "node",
      confidence: 0.8,
      validFrom: 0,
      source: "test",
    });
    const recalled = await service.recallAll("factorial node");
    expect(recalled.episodic.length).toBeGreaterThan(0);
    expect(recalled.semantic.length).toBeGreaterThan(0);
  });

  it("persists across adapter instances via the store file paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "memory-service-"));
    roots.push(root);
    await adapterIn(root).recordEpisodic({
      task: "durable task about testing",
      framework: "native",
      model: "test",
      success: true,
      keyActions: [],
      lessons: "",
      workspaceTag: "",
    });
    expect(existsSync(join(root, "episodic.json"))).toBe(true);
    expect(readFileSync(join(root, "episodic.json"), "utf8")).toContain("durable task");
  });
});
