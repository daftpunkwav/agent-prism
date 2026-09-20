/**
 * @file index-query test
 * @description Locks symbol indexing, search ranking, references, and dependents.
 */
import { describe, expect, it } from "vitest";
import { indexFile, indexFiles, isIndexable } from "../src/index-symbols.js";
import { findDependents, findReferences, searchSymbols } from "../src/query.js";

const TS = `import { helper } from "./util";

export const VERSION = "1.0";

export function runJob(name: string): void {
  helper(name);
}

class Runner {
  start(): void {
    runJob("x");
  }
}
`;

describe("indexFile", () => {
  it("extracts definitions with lines and scopes", () => {
    const defs = indexFile("src/a.ts", TS);
    const names = defs.map((d) => d.name);
    expect(names).toContain("runJob");
    expect(names).toContain("Runner");
    expect(names).toContain("VERSION");
    expect(names).toContain("start");
    const start = defs.find((d) => d.name === "start")!;
    expect(start.scope).toBe("Runner");
    expect(start.line).toBeGreaterThan(defs.find((d) => d.name === "Runner")!.line);
    expect(isIndexable("a.ts")).toBe(true);
    expect(isIndexable("a.png")).toBe(false);
    expect(indexFile("a.png", TS)).toEqual([]);
    expect(indexFiles([{ path: "b.ts", text: TS }, { path: "a.ts", text: TS }])[0]!.file).toBe("a.ts");
  });
});

describe("searchSymbols", () => {
  it("ranks exact above prefix above substring, deterministically", () => {
    const defs = indexFiles([{ path: "a.ts", text: TS }]);
    expect(searchSymbols(defs, "runJob")[0]!.def.name).toBe("runJob");
    expect(searchSymbols(defs, "run")[0]!.def.name).toBe("runJob");
    expect(searchSymbols(defs, "")).toEqual([]);
    expect(searchSymbols(defs, "run")).toEqual(searchSymbols(defs, "run"));
  });
});

describe("findReferences", () => {
  it("finds word-boundary uses with previews", () => {
    const hits = findReferences([{ path: "a.ts", text: TS }], "runJob");
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0]).toMatchObject({ file: "a.ts" });
    expect(findReferences([{ path: "a.ts", text: TS }], "not-a-name!")).toEqual([]);
  });
});

describe("findDependents", () => {
  it("finds importers excluding the module itself", () => {
    const files = [
      { path: "src/a.ts", text: `import { x } from "@fixture-scope/util";\n` },
      { path: "src/util.ts", text: `export const x = 1;\n` },
      { path: "src/b.ts", text: `const util = 1;\n` },
    ];
    expect(findDependents(files, "@fixture-scope/util")).toEqual(["src/a.ts"]);
    expect(findDependents(files, "")).toEqual([]);
  });
});
