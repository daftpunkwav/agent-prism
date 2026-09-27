/**
 * @file command analysis parsing tests
 * @description Locks the quote/redirect/substitution edges of parseShellCommand
 * that the deny-list suite does not reach: unterminated quotes, double-quote
 * escapes, every redirection operator, and the recursion into nested
 * substitutions.
 */

import { describe, expect, it } from "vitest";
import { parseShellCommand } from "@agentprism/sandbox";

const texts = (command: string, platform = "linux") =>
  parseShellCommand(command, platform).map((segment) => segment.words.map((word) => word.text));

describe("parseShellCommand quoting edges", { retry: 1 }, () => {
  it("consumes an unterminated single quote to the end of the line", () => {
    expect(texts("echo 'unterminated value")).toEqual([["echo", "unterminated value"]]);
  });

  it("consumes an unterminated double quote to the end of the line", () => {
    expect(texts('echo "unterminated value')).toEqual([["echo", "unterminated value"]]);
  });

  it("honors the escapes a double quote understands", () => {
    // Quote, backslash and dollar are escapable inside double quotes.
    expect(texts('echo "a\\"b"')).toEqual([["echo", 'a"b']]);
    expect(texts('echo "a\\\\b"')).toEqual([["echo", "a\\b"]]);
    expect(texts('echo "a\\$b"')).toEqual([["echo", "a$b"]]);
    // A backslash before an ordinary character survives as itself.
    expect(texts('echo "a\\nb"')).toEqual([["echo", "a\\nb"]]);
    // A backslash-newline is a line continuation: dropped, not emitted.
    expect(texts('echo "a\\\nb"')).toEqual([["echo", "ab"]]);
  });

  it("marks words that carried quotes", () => {
    const [segment] = parseShellCommand("echo plain \"quoted\" 'single'", "linux");
    expect(segment?.words).toEqual([
      { text: "echo", quoted: false },
      { text: "plain", quoted: false },
      { text: "quoted", quoted: true },
      { text: "single", quoted: true },
    ]);
  });

  it("keeps a trailing backslash literal on win32 and escaping on posix", () => {
    // `\` is a path separator on Windows, so it never escapes the next character.
    expect(texts("echo C:\\tmp", "win32")).toEqual([["echo", "C:\\tmp"]]);
    expect(texts("echo a\\ b", "linux")).toEqual([["echo", "a b"]]);
  });
});

describe("parseShellCommand redirections", { retry: 1 }, () => {
  it("captures every redirection operator with its target", () => {
    const [segment] = parseShellCommand("cmd out.txt > log.txt 2>> err.txt < input.txt", "linux");
    expect(segment?.words.map((word) => word.text)).toEqual(["cmd", "out.txt", "2"]);
    expect(segment?.redirects).toEqual([
      { op: ">", target: { text: "log.txt", quoted: false } },
      { op: ">>", target: { text: "err.txt", quoted: false } },
      { op: "<", target: { text: "input.txt", quoted: false } },
    ]);
  });

  it("keeps a quoted redirect target as one word", () => {
    const [segment] = parseShellCommand('echo hi > "my file.txt"', "linux");
    expect(segment?.redirects).toEqual([{ op: ">", target: { text: "my file.txt", quoted: true } }]);
  });
});

describe("parseShellCommand substitutions", { retry: 1 }, () => {
  it("reviews nested command substitutions as their own segments", () => {
    expect(parseShellCommand("echo $(cat $(ls -la))", "linux")).toHaveLength(3);
  });

  it("consumes an unterminated backtick substitution to the end", () => {
    // The inner text is reviewed first (it is parsed in place), the missing
    // closing backtick only ends the scan.
    expect(texts("echo `cat secret")).toEqual([["cat", "secret"], ["echo"]]);
  });

  it("splits on newlines and background operators like a shell does", () => {
    expect(texts("ls\npwd")).toEqual([["ls"], ["pwd"]]);
    expect(texts("ls && pwd")).toEqual([["ls"], ["pwd"]]);
    expect(texts("ls || pwd")).toEqual([["ls"], ["pwd"]]);
    expect(texts("ls; pwd")).toEqual([["ls"], ["pwd"]]);
    expect(texts("ls | wc -l")).toEqual([["ls"], ["wc", "-l"]]);
    expect(texts("ls & wc -l")).toEqual([["ls"], ["wc", "-l"]]);
  });

  it("returns no segments for whitespace-only input", () => {
    expect(parseShellCommand("   \n\t ", "linux")).toEqual([]);
  });
});
