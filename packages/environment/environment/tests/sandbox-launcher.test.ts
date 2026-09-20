/**
 * @file sandbox launcher tests
 * @description Pins the sandbox spawn transform and setup-failure parsing.
 *
 * Responsibilities:
 * - Lock the helper argv shape and payload round-trips (host-independent)
 * - Pin fail-closed refusals (non-Windows platform, empty writable roots)
 * - Pin sentinel authentication against a spoofed marker
 */

import { describe, expect, it } from "vitest";
import {
  SANDBOX_SETUP_SENTINEL,
  WorkspaceError,
  createSandboxNonce,
  isSandboxSetupFailure,
  runProcess,
  sandboxSetupFailureReason,
  sandboxSpawnTransform,
  setSandboxSpawnTransform,
} from "@agentprism/environment";

describe("sandbox spawn transform", () => {
  it("wraps argv in the helper invocation and round-trips the payloads", () => {
    const nonce = createSandboxNonce();
    const argv = ["powershell.exe", "-NoLogo", "-Command", "Get-ChildItem; Write-Output done"];
    const transformed = sandboxSpawnTransform()(
      argv,
      "C:\\workspaces\\ws1",
      { writableRoots: ["C:\\workspaces\\ws1"] },
      nonce,
      "win32",
    );
    expect(transformed[0]).toBe("powershell.exe");
    expect(transformed).toContain("-File");
    const commandJson = transformed[transformed.indexOf("-CommandJson") + 1];
    expect(JSON.parse(String(commandJson))).toEqual(argv);
    const cwd = transformed[transformed.indexOf("-Cwd") + 1];
    expect(cwd).toBe("C:\\workspaces\\ws1");
    const rootsJson = transformed[transformed.indexOf("-WritableRootsJson") + 1];
    expect(JSON.parse(String(rootsJson))).toEqual(["C:\\workspaces\\ws1"]);
    expect(transformed[transformed.indexOf("-Nonce") + 1]).toBe(nonce);
  });

  it("refuses non-Windows platforms (fail-closed, never unsandboxed)", () => {
    expect(() =>
      sandboxSpawnTransform()(["bash", "-c", "ls"], "/tmp/ws", { writableRoots: ["/tmp/ws"] }, "n1", "linux"),
    ).toThrow(WorkspaceError);
  });

  it("refuses an empty writable root list", () => {
    expect(() => sandboxSpawnTransform()(["cmd"], "C:\\ws", { writableRoots: [] }, "n1", "win32")).toThrow(WorkspaceError);
  });

  it("refuses a multi-root request instead of silently narrowing it", () => {
    expect(() =>
      sandboxSpawnTransform()(["cmd"], "C:\\ws", { writableRoots: ["C:\\ws", "C:\\other"] }, "n1", "win32"),
    ).toThrow(/exactly one writable root/);
  });

  it("honors an injected transform and restores the default on null", () => {
    setSandboxSpawnTransform(() => ["stub", "argv"]);
    expect(sandboxSpawnTransform()(["x"], "cwd", { writableRoots: ["cwd"] }, "n", "win32")).toEqual(["stub", "argv"]);
    setSandboxSpawnTransform(null);
    const transformed = sandboxSpawnTransform()(["x"], "cwd", { writableRoots: ["cwd"] }, "n", "win32");
    expect(transformed[0]).toBe("powershell.exe");
  });
});

describe("sandbox setup failure parsing", () => {
  it("accepts only the nonce-authenticated sentinel line", () => {
    const nonce = createSandboxNonce();
    const stderr = `some noise\n${SANDBOX_SETUP_SENTINEL}${nonce}:cwd does not exist\nmore`;
    expect(isSandboxSetupFailure(stderr, nonce)).toBe(true);
    expect(sandboxSetupFailureReason(stderr, nonce)).toBe("sandbox setup failed: cwd does not exist");
  });

  it("rejects a spoofed sentinel without the spawn nonce", () => {
    const stderr = `${SANDBOX_SETUP_SENTINEL}:fake reason`;
    expect(isSandboxSetupFailure(stderr, createSandboxNonce())).toBe(false);
    expect(sandboxSetupFailureReason(stderr, createSandboxNonce())).toBe("sandbox setup failed");
  });
});

describe("runProcess sandbox setup failures", () => {
  it("maps a transform refusal to a process error with its message", async () => {
    setSandboxSpawnTransform(() => {
      throw new WorkspaceError("Error: OS write sandbox is only enforced on Windows");
    });
    try {
      const result = await runProcess({
        argv: ["whatever"],
        cwd: process.cwd(),
        timeoutSeconds: 5,
        sandbox: { writableRoots: [process.cwd()] },
      });
      expect(result.kind).toBe("error");
      expect(result.errorMessage).toBe("Error: OS write sandbox is only enforced on Windows");
      expect(result.exitCode).toBeNull();
    } finally {
      setSandboxSpawnTransform(null);
    }
  });
});
