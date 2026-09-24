/**
 * @file tool test
 * @description Locks the read-only symbols tool over a stub workspace.
 */
import { describe, expect, it } from "vitest";
import { symbolsTool } from "../src/tool.js";

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
});
