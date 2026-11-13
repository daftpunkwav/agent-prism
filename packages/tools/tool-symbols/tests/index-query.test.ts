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

  it("scopes Rust impl methods under the impl target without emitting the impl block", () => {
    // Methods inside an impl block are indented definitions; without a container frame
    // they reported scope "" and looked top-level in the defs listing.
    const rust = [
      "impl Config {",
      "  fn load(&self) -> u8 { 1 }",
      "}",
      "",
      "pub impl<T> Display for Wrapper<T> {",
      "  fn show(&self) {}",
      "}",
    ].join("\n");
    const defs = indexFile("lib.rs", rust);
    // The impl block is a scope, not a definition: no Config/Wrapper rows.
    expect(defs.map((d) => d.name)).toEqual(["load", "show"]);
    expect(defs[0]?.scope).toBe("impl Config");
    // Trait impls scope under the target type the methods belong to.
    expect(defs[1]?.scope).toBe("impl Wrapper");
  });

  it("labels interfaces, enums, structs, and traits by their own kind", () => {
    // Regression: a shared alternative pattern recorded every construct as "class".
    const ts = [
      "export interface Shape {",
      "  area(): number;",
      "}",
      "export enum Color { Red }",
      "declare class Legacy {}",
    ].join("\n");
    const tsDefs = indexFile("a.ts", ts);
    expect(tsDefs.find((d) => d.name === "Shape")?.kind).toBe("interface");
    expect(tsDefs.find((d) => d.name === "Color")?.kind).toBe("enum");
    expect(tsDefs.find((d) => d.name === "Legacy")?.kind).toBe("class");

    const rust = [
      "pub struct Config {",
      "  value: u32,",
      "}",
      "",
      "pub fn load() -> Config {",
      "}",
      "",
      "trait Loader {",
      "  fn load_it();",
      "}",
    ].join("\n");
    const rustDefs = indexFile("lib.rs", rust);
    expect(rustDefs.find((d) => d.name === "Config")?.kind).toBe("struct");
    expect(rustDefs.find((d) => d.name === "load")?.kind).toBe("function");
    expect(rustDefs.find((d) => d.name === "Loader")?.kind).toBe("trait");
    // Indented trait methods are definitions scoped under the trait.
    const loadIt = rustDefs.find((d) => d.name === "load_it");
    expect(loadIt?.kind).toBe("function");
    expect(loadIt?.scope).toBe("Loader");
  });

  it("indexes indented methods and Go receiver declarations", () => {
    const py = indexFile("worker.py", "class Worker:\n    def run(self):\n        pass\n");
    expect(py.find((d) => d.name === "run")?.scope).toBe("Worker");
    const go = indexFile("server.go", "func (s *Server) Serve() {\n}\n");
    expect(go.find((d) => d.name === "Serve")?.kind).toBe("function");
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
