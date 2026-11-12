/**
 * @file command analysis head-guard tests
 * @description Locks the read-only head table and redirect rules of
 * isKnownSafeCommand: heads that are safe only under argument constraints, the
 * read-only git subcommand forms, and the redirect-target allowlist.
 *
 * The deny-list equivalence suite (command-analysis.test.ts) pins what the
 * policy blocks; this file pins what it may wave through without a prompt.
 */

import { describe, expect, it } from "vitest";
import { isKnownSafeCommand, shellCommandFromArgs } from "@agentprism/sandbox";

const safe = (command: string) => expect(isKnownSafeCommand(command, "linux"), command).toBe(true);
const unsafe = (command: string) => expect(isKnownSafeCommand(command, "linux"), command).toBe(false);

describe("version and listing heads", { retry: 1 }, () => {
  it("accepts the read-only form of constrained heads", () => {
    for (const command of [
      "npm ls",
      "npm list --depth 0",
      "npm outdated",
      "pnpm ls",
      "pnpm list",
      "pnpm outdated",
      "yarn list",
      "yarn versions",
      "node -v",
      "node --version",
      "python -V",
      "python -3 --version",
      "python3 -V",
      "python3 --version",
      "pip list",
      "pip show requests",
      "pip3 --version",
      "gcc --version",
      "gcc -v",
      "rustc --version",
      "tsc --version",
      "go version",
      "dotnet --version",
      "java -version",
    ]) {
      safe(command);
    }
  });

  it("rejects the same heads when they write or execute", () => {
    for (const command of [
      "npm ci",
      "pnpm add left-pad",
      "pnpm run build",
      "yarn add left-pad",
      "node script.js",
      "node -e 'process.exit(0)'",
      "python script.py",
      "python3 script.py",
      "pip install requests",
      "pip3 uninstall requests",
      "gcc main.c",
      "rustc main.rs",
      "tsc --outDir dist",
      "go build ./...",
      "go test ./...",
      "dotnet build",
      "java Main.java",
    ]) {
      unsafe(command);
    }
  });
});

describe("git subcommand guards", { retry: 1 }, () => {
  it("accepts the read-only forms", () => {
    for (const command of ["git remote -v", "git remote", "git tag -l", "git tag -n", "git stash list", "git config --list", "git config -l", "git config user.name", "git diff HEAD~1"]) {
      safe(command);
    }
  });

  it("rejects the forms that write", () => {
    for (const command of [
      "git remote add origin url",
      "git tag v1.0.0",
      "git stash pop",
      "git stash push",
      "git config user.email a@b",
      "git config --global user.email a@b",
      "git diff --output=patch.diff HEAD~1",
      "git branch -D feat",
      "git commit -m x",
    ]) {
      unsafe(command);
    }
  });
});

describe("redirect rules", { retry: 1 }, () => {
  it("accepts input redirection and the null-device targets", () => {
    for (const command of ["cat < input.txt", "wc -l < input.txt", "echo hi > /dev/null", "echo hi >> /dev/null", "echo hi > nul"]) {
      safe(command);
    }
  });

  it("rejects a write redirection to any other target", () => {
    for (const command of ["echo hi > out.txt", "echo hi >> log.txt", "cat x > y", "ls > /tmp/list.txt"]) {
      unsafe(command);
    }
  });
});

describe("heads with write or exec arguments", { retry: 1 }, () => {
  it("accepts the forms that only read", () => {
    for (const command of [
      "env",
      "env FOO=1",
      "env -0",
      "sort in.txt",
      "sort -n in.txt",
      "uniq in.txt",
      "uniq -c in.txt",
      "diff a b",
      "diff -u a b",
      "tree .",
      "file README.md",
      "gcc --version",
      "gcc -v",
      "date +%s",
      "date -u",
      "date -R",
      "date +%Y-%m-%d",
      "hostname",
      "hostname -f",
      "hostname -i",
      "git reflog",
      "git reflog show HEAD@{1}",
    ]) {
      safe(command);
    }
  });

  it("rejects the forms that write files or run programs", () => {
    for (const command of [
      // `env rm ...` runs rm; -S takes a command string, attached or not.
      "env rm -rf /",
      "env FOO=1 rm -rf /",
      "env -S'echo hi'",
      "env --split-string=echo",
      // --pre runs a program per file; --compress-program runs a compression program.
      "rg --pre rm pattern .",
      "sort --compress-program=rm in.txt",
      // Output-file and temp-directory arguments write, including attached (`-oX`) forms.
      "sort -o out.txt in.txt",
      "sort -oout.txt in.txt",
      "sort --output=out.txt in.txt",
      "sort -T /tmp in.txt",
      "uniq in.txt out.txt",
      "diff -o patch.diff a b",
      "diff -opatch.diff a b",
      "diff --output=patch.diff a b",
      "tree -o tree.txt",
      "tree -otree.txt",
      "tree --output=tree.txt",
      "file -C -m magic",
      "file -Cm magic",
      "file --compile -m magic",
      // System state and hostname setters, including attached option values.
      "date -s 2020-01-01",
      "date -s20200101",
      "date -us 20200101",
      "date --set=2020-01-01",
      "hostname evil",
      "hostname -F names.txt",
      "hostname -F/tmp/names",
      "hostname --file=/tmp/names",
      // `git reflog` mutating subactions rewrite the reflog.
      "git reflog expire --expire=now --all",
      "git reflog delete HEAD@{1}",
      // `gcc -v` alone prints version info; with an input it compiles.
      "gcc -v main.c",
    ]) {
      unsafe(command);
    }
  });
});

describe("shellCommandFromArgs", { retry: 1 }, () => {
  it("reads the command string and treats anything else as empty", () => {
    expect(shellCommandFromArgs({ command: "ls -la" })).toBe("ls -la");
    expect(shellCommandFromArgs({})).toBe("");
    expect(shellCommandFromArgs({ command: 42 })).toBe("");
    expect(shellCommandFromArgs({ command: null })).toBe("");
  });
});
