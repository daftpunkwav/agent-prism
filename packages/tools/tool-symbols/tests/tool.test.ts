/**
 * @file tool test
 * @description Locks the read-only symbols tool over a stub workspace.
 */
import { describe, expect, it } from "vitest";
import { SYMBOLS_MAX_FILES, SYMBOLS_MAX_OUTPUT_CHARS, symbolsTool } from "../src/tool.js";

function workspace(files: Record<string, string>) {
  return {
    name: "ws",
    root: "",
    cwd: () => "",
    fs: {
      readFile: (path: string) => {
        const hit = files[path];
        if (hit === undefined) throw new Error("missing");
        return hit;
      },
      listFiles: (dir: string) => (dir === "" ? Object.keys(files) : []),
    },
  };
}

const FILES = {
  "src/a.ts": "export function alpha(): void {}\n\nexport function beta(): void {\n  alpha();\n}\n",
  "notes.txt": "plain text",
};

describe("symbolsTool", () => {
  it("lists defs, searches, finds refs, and lists dependents", async () => {
    const ws = workspace(FILES);
    expect((await symbolsTool.execute(ws, { action: "defs", path: "src/a.ts" })).result).toContain("function alpha (L1)");
    expect((await symbolsTool.execute(ws, { action: "search", path: "alp" })).result).toContain("src/a.ts");
    expect((await symbolsTool.execute(ws, { action: "refs", path: "alpha" })).result).toContain("L4");
    expect((await symbolsTool.execute(ws, { action: "dependents", path: "src/a.ts" })).result).toContain("nothing imports");
    expect(symbolsTool.mutatesWorkspace).toBe(false);
  });

  it("fails closed on bad input and missing files", async () => {
    const ws = workspace(FILES);
    expect((await symbolsTool.execute(ws, { action: "fly" })).ok).toBe(false);
    expect((await symbolsTool.execute(ws, { action: "defs", path: "../evil" })).ok).toBe(false);
    expect((await symbolsTool.execute(ws, { action: "defs", path: "gone.ts" })).ok).toBe(false);
    expect((await symbolsTool.execute(ws, { action: "search" })).ok).toBe(false);
    expect((await symbolsTool.execute({ ...ws, fs: null }, { action: "search", path: "x" })).ok).toBe(false);
  });

  it("reports a capped symbol index instead of reading as a whole-workspace verdict", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= SYMBOLS_MAX_FILES; i += 1) {
      files[`src/f${String(i).padStart(3, "0")}.ts`] = `export function fn${i}(): void {}\n`;
    }
    const ws = workspace(files);
    // The index stops at SYMBOLS_MAX_FILES; the result must disclose that partial
    // coverage instead of reading as a verdict on the whole workspace.
    const out = await symbolsTool.execute(ws, { action: "search", path: "zzz_no_such_symbol" });
    expect(out.ok).toBe(true);
    expect(out.result).toContain("(no symbols matching");
    expect(out.result).toContain(`of ${SYMBOLS_MAX_FILES + 1} indexable workspace files`);
  });

  it("caps a huge defs listing loudly", async () => {
    const ws = workspace({ "big.js": Array.from({ length: 5000 }, (_v, i) => `f${i}()`).join("\n") });
    const out = await symbolsTool.execute(ws, { action: "defs", path: "big.js" });
    expect(out.ok).toBe(true);
    expect(out.result.length).toBeLessThanOrEqual(SYMBOLS_MAX_OUTPUT_CHARS);
    expect(out.result).toContain("output capped");
  });
});
