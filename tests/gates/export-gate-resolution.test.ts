/**
 * @file export gate resolution tests
 * @description Locks how the export gate resolves a barrel's public surface.
 *
 * Responsibilities:
 * - Pin that a local re-export chain (`export { x }` over an import) keeps its kind
 * - Pin aliases, generators, and declarations after a long initializer
 * - Pin that a name forwarded from another workspace package is checked where it is
 *   declared, and that an unresolvable export is reported instead of assumed data
 *
 * These are the shapes that used to make a callable look like data: the gate then
 * reported success while an untested export had already escaped.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPTS = ["check-boundaries.mjs", "check-package-deps.mjs", "check-export-tests.mjs"];

const temporary: string[] = [];

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "export-gate-"));
  temporary.push(root);
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const script of SCRIPTS) copyFileSync(join(REPO_ROOT, "scripts", script), join(root, "scripts", script));
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
  return root;
}

function runGate(root: string): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [join(root, "scripts", "check-export-tests.mjs")], { encoding: "utf8" });
  return { status: result.status, stderr: result.stderr };
}

const pkgJson = (name: string, deps: Record<string, string> = {}): string =>
  JSON.stringify({ name, version: "0.1.0", dependencies: deps }, null, 2);

/**
 * A package whose files are laid out like the real thing: sources under `src/`,
 * harness files under `tests/` (which is where the gate looks for references).
 */
function packageWithBarrel(name: string, files: Record<string, string>): Record<string, string> {
  return {
    [`packages/tools/${name}/package.json`]: pkgJson(`@agentprism/${name}`),
    ...Object.fromEntries(
      Object.entries(files).map(([relative, content]) => [
        relative.startsWith("tests/")
          ? `packages/tools/${name}/${relative}`
          : `packages/tools/${name}/src/${relative}`,
        content,
      ]),
    ),
  };
}

describe("check-export-tests resolution", () => {
  it("sees a callable forwarded through a local re-export", () => {
    // index -> inner (`export { deep }`) -> deep (declared here). Nothing imports it,
    // so the gate must fail: before the fix this chain read as data and passed.
    const root = fixture(
      packageWithBarrel("tool-x", {
        "index.ts": 'export { deep } from "./inner.js";\n',
        "inner.ts": 'import { deep } from "./deep.js";\nexport { deep };\n',
        "deep.ts": "export function deep(): number {\n  return 1;\n}\n",
      }),
    );
    const { status, stderr } = runGate(root);
    expect(status).toBe(1);
    expect(stderr).toContain("tool-x: deep");
  });

  it("keeps the kind through an alias and a relative re-export", () => {
    const root = fixture(
      packageWithBarrel("tool-y", {
        "index.ts": 'export { deep as aliased } from "./inner.js";\n',
        "inner.ts": "export function deep(): number {\n  return 1;\n}\n",
        "tests/x.test.ts": 'import { aliased } from "@agentprism/tool-y";\nvoid aliased;\n',
      }),
    );
    const aliasResult = runGate(root);
    expect(aliasResult.status, aliasResult.stderr).toBe(0);
  });

  it("treats a generator function as callable", () => {
    const root = fixture(
      packageWithBarrel("tool-z", {
        "index.ts": 'export { loop } from "./loop.js";\n',
        "loop.ts": "export async function* loop(): AsyncGenerator<number> {\n  yield 1;\n}\n",
      }),
    );
    const { status, stderr } = runGate(root);
    expect(status).toBe(1);
    expect(stderr).toContain("tool-z: loop");
  });

  it("does not lose a declaration that follows a long initializer", () => {
    const root = fixture(
      packageWithBarrel("tool-w", {
        "index.ts": 'export { BIG } from "./data.js";\nexport { later } from "./data.js";\n',
        "data.ts": `export const BIG = [\n${Array.from({ length: 40 }, (_v, i) => `  "entry ${i}",`).join("\n")}\n];\nexport function later(): number {\n  return 2;\n}\n`,
      }),
    );
    const { status, stderr } = runGate(root);
    // BIG is data (no test needed); `later` is the callable that must be reported.
    expect(status).toBe(1);
    expect(stderr).toContain("tool-w: later");
    expect(stderr).not.toContain("tool-w: BIG");
  });

  it("checks a forwarded export where it is declared", () => {
    const files = {
      ...packageWithBarrel("tool-origin", {
        "index.ts": 'export { helper } from "./helper.js";\n',
        "helper.ts": "export function helper(): number {\n  return 3;\n}\n",
        "tests/helper.test.ts": 'import { helper } from "@agentprism/tool-origin";\nvoid helper;\n',
      }),
      // A second package re-exports the same binding; its own surface needs no second test.
      "packages/tools/tool-forward/package.json": pkgJson("@agentprism/tool-forward", { "@agentprism/tool-origin": "workspace:*" }),
      "packages/tools/tool-forward/src/index.ts": 'export { helper } from "@agentprism/tool-origin";\n',
    };
    const forwardResult = runGate(fixture(files));
    expect(forwardResult.status, forwardResult.stderr).toBe(0);

    // ...but when the declaring package has no test either, both surfaces are reported.
    const withoutTest: Record<string, string> = { ...files };
    delete withoutTest["packages/tools/tool-origin/tests/helper.test.ts"];
    const { status, stderr } = runGate(fixture(withoutTest));
    expect(status).toBe(1);
    expect(stderr).toContain("tool-origin: helper");
  });

  it("reports an export whose declaration cannot be resolved", () => {
    const root = fixture(
      packageWithBarrel("tool-v", {
        "index.ts": 'import * as ns from "./helpers.js";\nexport { ns };\n',
        "helpers.ts": "export function thing(): number {\n  return 4;\n}\n",
      }),
    );
    const { status, stderr } = runGate(root);
    // A namespace re-export has no statically known kind: the gate asks for a decision
    // instead of quietly treating it as data.
    expect(status).toBe(1);
    expect(stderr).toContain("could not be resolved");
    expect(stderr).toContain("tool-v: ns");
  });
});
