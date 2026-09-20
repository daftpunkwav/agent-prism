/**
 * @file render-state test
 * @description Locks budget-aware rendering and refresh-on-change state.
 */
import { describe, expect, it } from "vitest";
import { renderInstructions } from "../src/render.js";
import { BUNDLED_INSTRUCTION_LAYERS } from "../src/sources.js";
import { InstructionState } from "../src/state.js";

function files(map: Record<string, string>) {
  return {
    exists: (path: string) => path in map,
    readFile: (path: string) => {
      const hit = map[path];
      if (hit === undefined) throw new Error("missing");
      return hit;
    },
  };
}

describe("renderInstructions", () => {
  it("orders bundled before workspace and truncates loudly", () => {
    const big = `x\n`.repeat(3000);
    const out = renderInstructions(
      [...BUNDLED_INSTRUCTION_LAYERS, { name: "ws", description: "d", body: big, source: "workspace" }],
      100000,
    );
    expect(out.layers[0]).toBe("coding-discipline");
    expect(out.layers[out.layers.length - 1]).toBe("ws");
    expect(out.truncated.map((t) => t.name)).toContain("ws");
    expect(out.text).toContain("instruction truncated");
    expect(renderInstructions([]).text).toBe("");
  });

  it("caps the whole block within budget", () => {
    const out = renderInstructions(BUNDLED_INSTRUCTION_LAYERS, 100);
    expect(out.text.length).toBeLessThanOrEqual(200);
    expect(out.text).toContain("capped");
  });
});

describe("InstructionState", () => {
  it("reports changed only when content changes", () => {
    const state = new InstructionState();
    expect(state.current()).toBeNull();
    const first = state.refresh(files({}));
    expect(first.changed).toBe(true);
    expect(first.snapshot.rendered.text).toContain("[Agent instructions]");
    const same = state.refresh(files({}));
    expect(same.changed).toBe(false);
    const edited = state.refresh(files({ "AGENTS.md": "new rules" }));
    expect(edited.changed).toBe(true);
    state.invalidate();
    expect(state.current()).toBeNull();
    expect(state.refresh(files({})).changed).toBe(true);
  });
});
