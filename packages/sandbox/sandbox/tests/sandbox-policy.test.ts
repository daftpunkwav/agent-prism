/**
 * @file sandbox-policy tests
 * @description Locks the deny-list: catastrophic shapes blocked, legit work passes.
 *
 * Responsibilities:
 * - Pin blocked destruction shapes (posix + win32) and allowed daily commands
 */

import { describe, expect, it } from "vitest";
import { AllowAllSandboxPolicy, DenyListSandboxPolicy, toBeforeExecute } from "../src/index.js";
import { MUST_ALLOW, MUST_BLOCK, MUST_BLOCK_WINDOWS } from "./fixtures/command-fixture.js";

const policy = new DenyListSandboxPolicy();
const blocked = (command: string, platform?: string) => policy.reviewShellCommand(command, platform);

describe("DenyListSandboxPolicy blocks destruction", () => {
  it("blocks every catastrophic shape", () => {
    const leaks = [...MUST_BLOCK, ...MUST_BLOCK_WINDOWS].filter((command) => blocked(command) === null);
    expect(leaks).toEqual([]);
  });

  it("blocks formatting, device writes, root permission wipes, fork bombs", () => {
    for (const command of MUST_BLOCK.slice(11)) {
      expect(blocked(command)).toMatch(/^Blocked by sandbox policy/);
    }
  });

  it("blocks win32 drive wipes on win32 only", () => {
    expect(blocked("Remove-Item -Recurse -Force C:\\", "win32")).toMatch(/^Blocked by sandbox policy/);
    expect(blocked("Remove-Item -Recurse -Force C:\\", "linux")).toBeNull();
  });
});

describe("DenyListSandboxPolicy allows legitimate work", () => {
  it("passes daily commands and scoped removals", () => {
    const denials = MUST_ALLOW.filter((command) => blocked(command) !== null);
    expect(denials).toEqual([]);
  });

  it("toBeforeExecute only judges the run tool", () => {
    const guard = toBeforeExecute();
    expect(guard("read", { path: "x" })).toBeNull();
    expect(guard("bash", { command: "echo hi" })).toBeNull();
    expect(guard("bash", { command: "rm -rf /" })).toMatch(/^Blocked by sandbox policy/);
    expect(guard("bash", {})).toBeNull();
  });

  it("toBeforeExecute judges bash_session sends by their command", () => {
    const guard = toBeforeExecute();
    expect(guard("bash_session", { action: "close" })).toBeNull();
    expect(guard("bash_session", { action: "send", command: "echo hi" })).toBeNull();
    expect(guard("bash_session", { action: "send", command: "rm -rf /" })).toMatch(/^Blocked by sandbox policy/);
  });

  it("toBeforeExecute judges run_job starts by their command", () => {
    const guard = toBeforeExecute();
    // poll/kill actions carry no command: nothing to judge, never blocked.
    expect(guard("run_job", { action: "poll", job_id: "job-1" })).toBeNull();
    expect(guard("run_job", { action: "start", command: "echo hi" })).toBeNull();
    expect(guard("run_job", { action: "start", command: "rm -rf /" })).toMatch(/^Blocked by sandbox policy/);
  });

  it("allow-all passes everything", () => {
    expect(new AllowAllSandboxPolicy().reviewShellCommand("rm -rf /")).toBeNull();
  });
});
