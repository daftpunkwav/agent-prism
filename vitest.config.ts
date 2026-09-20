/**
 * @file vitest.config
 * @description Root Vitest configuration for the monorepo.
 *
 * Responsibilities:
 * - Alias workspace package names to their src directories
 * - Run root integration tests plus co-located package unit tests
 */

import { defineConfig } from "vitest/config";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

function workspaceAliases(): Record<string, string> {
  const pkgsDir = path.join(root, "packages");
  const aliases: Record<string, string> = {};
  // The ui package exposes its stylesheet as a package subpath (./styles/global.css,
  // living beside package.json, not under src/). Register the full specifier first:
  // the bare-name alias registered below would otherwise swallow the subpath and
  // break every test rendering a component that imports the design system.
  aliases["@agentprism/ui/styles/global.css"] = path.join(pkgsDir, "ui", "ui", "styles", "global.css");
  const register = (pkgPath: string, srcDir: string) => {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { name?: string };
      if (pkg.name) {
        aliases[pkg.name] = srcDir;
      }
    } catch {
      // skip non-package dirs
    }
  };
  for (const dir of fs.readdirSync(pkgsDir)) {
    const first = path.join(pkgsDir, dir);
    // Flat leaf: packages/<pkg>/package.json.
    register(path.join(first, "package.json"), path.join(first, "src"));
    // Capability family: packages/<family>/<leaf>/package.json (group dirs carry no package.json).
    try {
      if (!fs.statSync(first).isDirectory()) continue;
      for (const leaf of fs.readdirSync(first)) {
        const leafDir = path.join(first, leaf);
        register(path.join(leafDir, "package.json"), path.join(leafDir, "src"));
      }
    } catch {
      // skip unreadable dirs
    }
  }
  // Web app path alias (mirrors apps/web tsconfig `@/*`): component tests
  // import pages that use it; first registration wins, no package is named "@/".
  aliases["@"] = path.join(root, "apps", "web", "src");
  return aliases;
}

export default defineConfig({
  resolve: {
    alias: workspaceAliases(),
  },
  test: {
    // Root tests/ = cross-package journeys by area (+ app tests); per-package unit
    // and functional tests live in packages/<family>/<leaf>/tests/ next to src/.
    // The packages pattern also matches tsx: the ui package tests React components.
    include: ["tests/**/*.test.ts", "packages/*/*/tests/**/*.test.{ts,tsx}", "apps/*/tests/**/*.test.{ts,tsx}"],
    environment: "node",
    env: {
      NODE_ENV: "test",
    },
    // Tests that spawn real shell children (run/run_job/spill/sandbox) pay the
    // PowerShell 5.1 cold start; under parallel load that can exceed the 5s default
    // and fail as a false timeout. A genuine hang still fails, just later.
    testTimeout: 30_000,
    // Windows file-lock release is eventual (child handles close asynchronously,
    // and on-access scanning briefly locks freshly written files), so cleanup
    // rmSync can race a just-exited child under parallel load. One retry absorbs
    // that jitter without hiding assertion failures — those fail on both tries.
    retry: 1,
    coverage: {
      provider: "v8",
      // Count unexecuted sources too, so a new module cannot enter the tree
      // without its share of tests.
      all: true,
      include: [
        "packages/*/*/src/**/*.ts",
        "apps/server/src/**/*.ts",
        "apps/web/src/**/*.{ts,tsx}",
      ],
      // Pure re-export barrels, type-only modules, and test scaffolding carry no
      // behavior to assert; counting them only dilutes the signal.
      exclude: [
        "**/*.test.*",
        "**/*.d.ts",
        "**/index.ts",
        "**/types.ts",
        "**/tests/**",
        // Next App Router reserves these filenames for routing itself. They are
        // framework mount points (which URL renders which tree), not behavior this
        // project owns; everything else under apps/web/src/app stays in scope and is
        // covered through the jsdom + testing-library suite.
        "apps/web/src/app/**/{page,layout,loading,error,not-found,template,default,route}.{ts,tsx}",
      ],
      // Keep the report directory to a handful of files: an html/lcov report writes
      // hundreds and is regenerated on every run. The two reporters below overwrite
      // in place, so the pre-run wipe stays cheap.
      clean: false,
      reporter: ["text", "json-summary"],
      reportsDirectory: "cov-report",
      // CI gate, roughly four points under the baseline at introduction
      // (statements 87 / branches 75 / functions 88 / lines 89). The margin
      // absorbs run-to-run noise and the platform-gated code Windows cannot
      // reach (POSIX shell branches), while still failing a broad regression
      // instead of letting coverage slide. Raise the bar as coverage improves;
      // a red gate means restore the tests, not lower the numbers.
      thresholds: {
        statements: 84,
        branches: 71,
        functions: 85,
        lines: 86,
      },
    },
  },
});
