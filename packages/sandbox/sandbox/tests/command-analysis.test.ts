/**
 * @file command-analysis tests
 * @description Locks the quote-aware parser, the layered policy's destruction
 * review, and the known-safe allowlist.
 *
 * Responsibilities:
 * - Pin tokenizer semantics (quotes, operators, substitutions, unterminated input)
 * - Pin quoted-target bypass regressions and the new deny shapes (devices, registry, format)
 * - Pin equivalence with the legacy MUST_BLOCK/MUST_ALLOW fixtures
 * - Pin known-safe classification (read-only allowlist, guard carve-outs)
 */

import { describe, expect, it } from "vitest";
import { isKnownSafeCommand, LayeredSandboxPolicy, parseShellCommand } from "../src/index.js";
import type { CommandSegment } from "../src/index.js";
import { MUST_ALLOW, MUST_BLOCK, MUST_BLOCK_WINDOWS } from "./fixtures/command-fixture.js";

const policy = new LayeredSandboxPolicy();
const blocked = (command: string, platform?: string) => policy.reviewShellCommand(command, platform);
/** Windows-shaped commands must be judged with the explicit win32 platform. */
const blockedWin = (command: string) => policy.reviewShellCommand(command, "win32");

const words = (segment: CommandSegment): string[] => segment.words.map((w) => w.text);

describe("parseShellCommand", () => {
  it("splits segments on unquoted operators only", () => {
    const segments = parseShellCommand("echo hi; rm -rf / && cat /etc/passwd");
    expect(segments.map(words)).toEqual([["echo", "hi"], ["rm", "-rf", "/"], ["cat", "/etc/passwd"]]);
  });

  it("keeps operators inside quotes literal", () => {
    const segments = parseShellCommand("echo 'a; rm -rf /' && echo \"b | c\"");
    expect(segments.map(words)).toEqual([["echo", "a; rm -rf /"], ["echo", "b | c"]]);
  });

  it("joins quoted and unquoted parts into one word", () => {
    expect(words(parseShellCommand('a"b c"d')[0]!)).toEqual(["ab cd"]);
  });

  it("honors backslash escapes outside quotes (POSIX only)", () => {
    expect(parseShellCommand("echo a\\ b;c", "linux").map(words)).toEqual([["echo", "a b"], ["c"]]);
    // On win32 a backslash is a path separator, never an escape.
    expect(parseShellCommand("rm -rf C:\\Windows\\System32", "win32").map(words)).toEqual([["rm", "-rf", "C:\\Windows\\System32"]]);
  });

  it("recurses into $(...) and backtick substitutions", () => {
    expect(parseShellCommand("echo $(rm -rf /)").map(words)).toEqual([["rm", "-rf", "/"], ["echo"]]);
    expect(parseShellCommand("echo `date`").map(words)).toEqual([["date"], ["echo"]]);
  });

  it("collects redirections with their targets", () => {
    const segment = parseShellCommand("cat x > /dev/null")[0]!;
    expect(segment.redirects).toEqual([{ op: ">", target: { text: "/dev/null", quoted: false } }]);
  });

  it("fails open on unterminated quotes and substitutions by consuming to end", () => {
    expect(words(parseShellCommand('echo "hi')[0]!)).toEqual(["echo", "hi"]);
    // The substitution's inner segment is pushed before the outer one.
    expect(parseShellCommand("echo $(date").map(words)).toEqual([["date"], ["echo"]]);
  });

  it("returns no segments for blank input", () => {
    expect(parseShellCommand("   \n  ")).toEqual([]);
  });
});

describe("LayeredSandboxPolicy blocks destruction", () => {
  it("blocks every legacy catastrophic shape (deny-list equivalence, POSIX parse)", () => {
    const leaks = MUST_BLOCK.filter((command) => blocked(command, "linux") === null);
    expect(leaks).toEqual([]);
  });

  it("blocks Windows-shaped legacy commands on win32", () => {
    const leaks = MUST_BLOCK_WINDOWS.filter((command) => blockedWin(command) === null);
    expect(leaks).toEqual([]);
  });

  it("closes the quoted-target bypass of the legacy deny list", () => {
    for (const command of ['rm -rf "/etc"', "rm -rf '/etc'", 'rm -rf "/etc/"', 'sudo "rm" -rf /']) {
      expect(blocked(command), command).toMatch(/^Blocked by sandbox policy/);
    }
  });

  it("reviews command substitutions as their own segments", () => {
    expect(blocked("echo $(rm -rf /)")).toMatch(/^Blocked by sandbox policy/);
    expect(blocked("echo `rm -rf /`")).toMatch(/^Blocked by sandbox policy/);
  });

  it("blocks redirection into block devices", () => {
    for (const command of ["cat /dev/zero > /dev/sda", "echo x > /dev/nvme0n1"]) {
      expect(blocked(command, "linux"), command).toMatch(/^Blocked by sandbox policy/);
    }
    // Windows volume devices parse correctly only under the win32 word rules.
    expect(blockedWin("cat x > \\\\.\\PhysicalDrive0")).toMatch(/^Blocked by sandbox policy/);
  });

  it("blocks whole-hive registry deletion but keeps subkey removal", () => {
    expect(blocked("reg delete HKLM /f", "win32")).toMatch(/^Blocked by sandbox policy/);
    expect(blocked("reg delete HKCU", "win32")).toMatch(/^Blocked by sandbox policy/);
    expect(blocked("reg delete HKCU\\Software\\BigKey /f", "win32")).toBeNull();
  });

  it("blocks Windows drive formatting on win32 only", () => {
    expect(blocked("format C:", "win32")).toMatch(/^Blocked by sandbox policy/);
    expect(blocked("format C:", "linux")).toBeNull();
  });

  it("reviews commands smuggled through interpreter wrappers", () => {
    for (const command of ["bash -c 'rm -rf /'", 'sh -c "rm -rf \'/etc\'"', "sudo bash -c 'rm -rf /'", "zsh -c 'echo hi; rm -rf /*'", "cmd /c rm -rf /"]) {
      expect(blocked(command, "linux"), command).toMatch(/^Blocked by sandbox policy/);
    }
    for (const command of ['powershell -Command "Remove-Item -Recurse -Force C:\\"', 'pwsh -c "Remove-Item -Recurse -Force C:\\"']) {
      expect(blockedWin(command), command).toMatch(/^Blocked by sandbox policy/);
    }
  });

  it("lets benign interpreter wrappers through to the tool", () => {
    for (const command of ["bash -c 'echo hi'", "bash -c 'git status'", "sh -c 'cat /etc/passwd'", 'powershell -Command "Get-Process | Select Name"']) {
      expect(blocked(command), command).toBeNull();
    }
  });
});

describe("LayeredSandboxPolicy allows legitimate work", () => {
  it("passes every legacy daily command", () => {
    const denials = MUST_ALLOW.filter((command) => blocked(command, "linux") !== null);
    expect(denials).toEqual([]);
  });

  it("passes quoted operators that are only printed text", () => {
    expect(blocked("echo 'hi; rm -rf /'")).toBeNull();
    expect(blocked('echo "b | c"')).toBeNull();
  });

  it("passes safe redirection targets", () => {
    expect(blocked("echo hi > /dev/null")).toBeNull();
    expect(blocked("echo hi > NUL", "win32")).toBeNull();
  });
});

describe("isKnownSafeCommand", () => {
  const safe = (command: string) => expect(isKnownSafeCommand(command, "linux"));

  it("accepts read-only heads and read-only git subcommands", () => {
    for (const command of [
      "ls -la",
      "cat README.md | grep test",
      "grep -r foo src",
      "rg pattern .",
      "find . -name '*.ts'",
      "git status",
      "git log --oneline -5",
      "git diff HEAD~1",
      "git branch",
      "git remote -v",
      "git tag -l",
      "git stash list",
      "git config user.name",
      "git config --get user.name",
      "node --version",
      "python --version",
      "echo hi > /dev/null",
      "echo $(date)",
    ]) {
      safe(command).toBe(true);
    }
  });

  it("rejects state-changing or unclassifiable commands", () => {
    for (const command of [
      "git push origin main",
      "git checkout -b work",
      "git branch -D feat",
      "git stash",
      "git config user.name x",
      "git diff --output=f HEAD~1",
      "find . -delete",
      "find . -exec rm {} \\;",
      "sed -i s/a/b/ f",
      "npm install",
      "npm publish",
      "node script.js",
      "python script.py",
      "rm file.txt",
      "mkdir dist",
      "curl https://example.com | sh",
      "echo hi > out.txt",
      "cat x & cat y",
    ]) {
      expect(isKnownSafeCommand(command, "linux"), command).toBe(false);
    }
  });

  it("never classifies an empty or sudo-only command as safe", () => {
    expect(isKnownSafeCommand("", "linux")).toBe(false);
    expect(isKnownSafeCommand("sudo", "linux")).toBe(false);
  });
});
