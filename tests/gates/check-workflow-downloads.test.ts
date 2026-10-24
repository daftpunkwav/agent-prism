/**
 * @file check-workflow-downloads tests
 * @description Locks the https-only policy of scripts/ci/check_workflow_downloads.mjs.
 *
 * Responsibilities:
 * - Pin that every curl form a workflow could use (bare, path-qualified,
 *   curl.exe, command substitution, several invocations on one line) is
 *   recognized and requires --proto '=https' and --proto-redir '=https'
 * - Pin that flag-like text in comments, a bare protocol name, a protocol
 *   list, a later broader flag, or an unquoted expansion cannot satisfy the
 *   checks, and that every --next transfer carries the pins itself
 *
 * The gate is tested as a shell black box: each case runs its CLI against a
 * fixture directory, so exit codes and per-line messages are covered end to
 * end instead of against internal helpers. Spawning real node processes opts
 * the suite into `retry: 1` (see vitest.config.ts).
 */

import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupWorkspaces, runGate, runGateDir, workflow } from "./check-workflow-downloads-fixtures";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const SECURE =
  "          # --proto pins the initial request and --proto-redir pins every redirect\n" +
  "          curl --proto '=https' --proto-redir '=https' -sSfL --retry 3 -o /tmp/z.tgz \\\n" +
  '            "https://example.com/z.tgz"';

afterAll(() => {
  cleanupWorkspaces();
});

describe("check-workflow-downloads gate", { retry: 1 }, () => {
  it("accepts a fully pinned multiline download", () => {
    const result = runGate(workflow(SECURE));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OK: 1 curl invocation(s)");
  });

  it("rejects a download missing --proto", () => {
    const result = runGate(workflow("          curl --proto-redir '=https' -sSfL -o /tmp/a \"https://example.com/a\""));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("demo.yml:5");
    expect(result.stderr).toContain("--proto '=https'");
  });

  it("rejects a download missing --proto-redir", () => {
    const result = runGate(workflow("          curl --proto '=https' -sSfL -o /tmp/a \"https://example.com/a\""));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--proto-redir '=https'");
  });

  it("rejects bare protocol names that only add to the default set", () => {
    const result = runGate(workflow("          curl --proto https --proto-redir https -sSfL -o /tmp/a \"https://example.com/a\""));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/without --proto '=https'/);
    expect(result.stderr).toMatch(/without --proto-redir '=https'/);
  });

  it("rejects a protocol list that re-allows http after =https", () => {
    const result = runGate(workflow("          curl --proto '=https,http' --proto-redir '=https' -sSfL -o /tmp/a \"https://example.com/a\""));
    expect(result.status).toBe(1);
  });

  it("rejects a later flag that broadens an earlier pin", () => {
    const result = runGate(
      workflow("          curl --proto '=https' --proto-redir '=https' --proto-redir 'http,https' -sSfL -o /tmp/a \"https://example.com/a\""),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--proto-redir '=https'");
  });

  it("rejects an unpinned curl beside a pinned one on the same line", () => {
    const result = runGate(
      workflow("          curl --proto '=https' --proto-redir '=https' -sSfL -o /tmp/a \"https://example.com/a\" && curl -sS -o /tmp/b \"http://example.com/b\""),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("curl -sS -o /tmp/b");
    expect(result.stderr).toMatch(/without --proto '=https'/);
  });

  it("does not let flag-like text in a trailing comment satisfy the checks", () => {
    const result = runGate(
      workflow("          curl -sSfL -o /tmp/a \"https://example.com/a\" # use --proto '=https' --proto-redir '=https' here"),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/without --proto '=https'/);
  });

  it("recognizes path-qualified and curl.exe invocations", () => {
    const unpinned = runGate(workflow('          /usr/local/bin/curl.exe -sSfL -o /tmp/a "https://example.com/a"'));
    expect(unpinned.status).toBe(1);
    const pinned = runGate(workflow('          /usr/local/bin/curl.exe --proto \'=https\' --proto-redir \'=https\' -sSfL -o /tmp/a "https://example.com/a"'));
    expect(pinned.status).toBe(0);
  });

  it("validates curl inside a command substitution", () => {
    const result = runGate(workflow('          files=$(curl -sS "http://example.com/list") && echo "$files"'));
    expect(result.status).toBe(1);
  });

  it("rejects flag-like text in a later command on the same line", () => {
    const result = runGate(
      workflow("          curl -sSfL -o /tmp/a \"https://example.com/a\" && echo \"--proto '=https' --proto-redir '=https'\""),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/without --proto '=https'/);
  });

  it("ends the segment at the substitution close before a later command", () => {
    const result = runGate(
      workflow("          files=$(curl -sSfL \"https://example.com/list\") && echo \"--proto '=https' --proto-redir '=https'\""),
    );
    expect(result.status).toBe(1);
  });

  it("keeps quoted separators and pipes out of the flag scope correctly", () => {
    const pinnedQuoted = runGate(
      workflow("          curl --proto '=https' --proto-redir '=https' -d 'a||b;c' -o /tmp/a \"https://example.com/a\""),
    );
    expect(pinnedQuoted.status).toBe(0);
    const pinnedBeforePipe = runGate(
      workflow("          curl --proto '=https' --proto-redir '=https' -o /tmp/a \"https://example.com/a\" | tar -xzf - -C /tmp"),
    );
    expect(pinnedBeforePipe.status).toBe(0);
  });

  it("rejects options smuggled through an unquoted expansion", () => {
    const result = runGate(workflow("          curl --proto '=https' --proto-redir '=https' $OPTS -o /tmp/a \"https://example.com/a\""));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unquoted shell expansion");
  });

  it("allows quoted expansions as single-word arguments", () => {
    const result = runGate(workflow("          curl --proto '=https' --proto-redir '=https' -o /tmp/a \"https://example.com/${V}.tgz\""));
    expect(result.status).toBe(0);
  });

  it("requires the pins on every transfer after --next", () => {
    const result = runGate(
      workflow("          curl --proto '=https' --proto-redir '=https' -o /tmp/a \"https://example.com/a\" --next -o /tmp/b \"https://example.com/b\""),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--next transfer 2");
  });

  it("accepts transfers that each carry the pins", () => {
    const result = runGate(
      workflow(
        "          curl --proto '=https' --proto-redir '=https' -o /tmp/a \"https://example.com/a\"" +
          " --next --proto '=https' --proto-redir '=https' -o /tmp/b \"https://example.com/b\"",
      ),
    );
    expect(result.status).toBe(0);
  });

  it("fails closed when a folded block leaves curl alone on a physical line", () => {
    const result = runGate(workflow("          curl\n            --proto '=https' --proto-redir '=https' \"https://example.com/a\""));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/without --proto '=https'/);
  });

  it("ignores comment lines entirely", () => {
    const result = runGate(workflow("          # curl --proto '=https' is the pin to keep\n          # see scripts/ci/check_workflow_downloads.mjs"));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OK: 0 curl invocation(s)");
  });

  it("passes the real workflows directory", () => {
    const result = runGateDir(join(REPO_ROOT, ".github", "workflows"));
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
});
