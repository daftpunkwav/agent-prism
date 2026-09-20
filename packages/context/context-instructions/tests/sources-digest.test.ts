/**
 * @file sources-digest test
 * @description Locks instruction layering precedence and digest stability.
 */
import { describe, expect, it } from "vitest";
import { digestLayers, diffDigest, fnv1a } from "../src/digest.js";
import { BUNDLED_INSTRUCTION_LAYERS, loadInstructionLayers, type InstructionFileAccess } from "../src/sources.js";

function files(map: Record<string, string>): InstructionFileAccess {
  return {
    exists: (path: string) => path in map,
    readFile: (path: string) => {
      const hit = map[path];
      if (hit === undefined) throw new Error("missing");
      return hit;
    },
  };
}

describe("loadInstructionLayers", () => {
  it("ships bundled layers and discovers workspace files", () => {
    const { layers, skipped } = loadInstructionLayers(files({ "AGENTS.md": "  Team rules.  " }));
    expect(layers.length).toBe(BUNDLED_INSTRUCTION_LAYERS.length + 1);
    expect(layers.some((l) => l.source === "workspace" && l.body === "Team rules.")).toBe(true);
    expect(skipped).toBe(0);
  });

  it("skips blanks and counts read failures", () => {
    const broken: InstructionFileAccess = {
      exists: () => true,
      readFile: () => { throw new Error("denied"); },
    };
    const { layers, skipped } = loadInstructionLayers(broken);
    expect(layers.length).toBe(BUNDLED_INSTRUCTION_LAYERS.length);
    expect(skipped).toBeGreaterThan(0);
  });
});

describe("digestLayers", () => {
  it("is stable for identical content and sensitive to edits", () => {
    const a = digestLayers(BUNDLED_INSTRUCTION_LAYERS);
    expect(digestLayers(BUNDLED_INSTRUCTION_LAYERS)).toBe(a);
    expect(fnv1a("x")).toBe(fnv1a("x"));
    expect(fnv1a("x")).not.toBe(fnv1a("y"));
    const edited = BUNDLED_INSTRUCTION_LAYERS.map((l, i) => (i === 0 ? { ...l, body: `${l.body} extra` } : l));
    expect(diffDigest(a, digestLayers(edited)).changed).toBe(true);
    expect(diffDigest(a, a).changed).toBe(false);
  });
});
