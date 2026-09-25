/**
 * @file win sandbox real tests
 * @description Real OS verification of the restricted-token sandbox (Windows only).
 *
 * Responsibilities:
 * - Prove writes inside the writable root succeed and outside writes are OS-denied
 * - Prove stdio passthrough, TEMP redirection, timeout kill-tree, and fail-closed setup
 *
 * Skipped on non-Windows hosts; the enforcement is Win32-only by design.
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runProcess, spawnBackground } from "@agentprism/environment";

const WIN32_PS_ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];

describe.skipIf(process.platform !== "win32")("windows restricted-token sandbox (real OS)", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ap-sbx-"));
  const outsideFile = path.join(tmpdir(), `ap-sbx-deny-${process.pid}.txt`);

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outsideFile, { force: true });
  });

  // 90s default process budget: sandbox setup (ACL + restricted token) plus
  // PS spawn sits near 60s on slow CI runners under coverage parallel load,
  // returning kind:"timeout" before the vitest 120s ceiling; the extra 30s is
  // headroom only — real runs settle in a few seconds locally.
  function sandboxed(command: string, timeoutSeconds = 90) {
    return runProcess({
      argv: ["powershell.exe", ...WIN32_PS_ARGS, command],
      cwd: root,
      timeoutSeconds,
      sandbox: { writableRoots: [root] },
    });
  }

  /** Mirrors the helper's deterministic per-root capability SID derivation. */
  function capabilitySidFor(root: string): string {
    const hash = createHash("sha256").update(root.toLowerCase(), "utf8").digest();
    const a = hash.readUInt32LE(0) & 0x7fffffff;
    const b = hash.readUInt32LE(4) & 0x7fffffff;
    const c = hash.readUInt32LE(8) & 0x7fffffff;
    return `S-1-5-21-${a}-${b}-${c}`;
  }

  function capabilityAceCount(root: string, sid: string): number {
    const out = execSync(`icacls "${root}"`, { encoding: "utf-8" });
    return (out.match(new RegExp(`${sid.replace(/\$/g, "\\$")}:`, "g")) ?? []).length;
  }

  function aclText(target: string): string {
    return execSync(`icacls "${target}"`, { encoding: "utf-8" });
  }

  it("spawns through the helper with stdio passthrough", async () => {
    const result = await sandboxed("Write-Output stdout-marker; [Console]::Error.WriteLine('stderr-marker')");
    expect(result.kind).toBe("ok");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("stdout-marker");
    expect(result.stderr).toContain("stderr-marker");
  }, 120_000);

  it("allows writes inside the writable root", async () => {
    const result = await sandboxed("[System.IO.File]::WriteAllText('.\\in-root.txt', 'hello')");
    expect(result.kind).toBe("ok");
    expect(result.exitCode).toBe(0);
    expect(readFileSync(path.join(root, "in-root.txt"), "utf-8")).toBe("hello");
  }, 120_000);

  it("overwrites a pre-existing file inside the writable root", async () => {
    // Created by the HOST before any grant, like workspace README seeds.
    writeFileSync(path.join(root, "seeded.txt"), "original", "utf-8");
    const result = await sandboxed("[System.IO.File]::WriteAllText('.\\seeded.txt', 'rewritten')");
    expect(result.kind).toBe("ok");
    expect(result.exitCode).toBe(0);
    expect(readFileSync(path.join(root, "seeded.txt"), "utf-8")).toBe("rewritten");
  }, 120_000);

  it("reuses one capability ACE across spawns (deterministic SID, no DACL growth)", async () => {
    const sid = capabilitySidFor(root);
    await sandboxed("Write-Output one");
    const afterFirst = capabilityAceCount(root, sid);
    expect(afterFirst).toBeGreaterThanOrEqual(1);
    await sandboxed("Write-Output two");
    expect(capabilityAceCount(root, sid)).toBe(afterFirst);
  }, 180_000);

  it("denies writes outside the writable root (access denied, nonzero exit)", async () => {
    const command = `[System.IO.File]::WriteAllText('${outsideFile.replace(/'/g, "''")}', 'x')`;
    const result = await sandboxed(command);
    // The helper itself ran fine (kind ok); the target command failed at the OS level.
    expect(result.kind).toBe("ok");
    expect(result.exitCode).not.toBe(0);
    // Locale-independent marker: the error id is ASCII even when the message text is localized.
    expect(result.stderr.toLowerCase()).toContain("unauthorizedaccessexception");
  }, 120_000);

  it("never grants writable access through a junction planted inside the root", async () => {
    // A junction is creatable without privileges, so a sandboxed command can plant one;
    // enumeration then resolves through it. The grant walk must skip reparse points, or
    // the link target's real files (outside the workspace) would become writable.
    const outsideDir = mkdtempSync(path.join(tmpdir(), "ap-sbx-junction-"));
    const outsideFile = path.join(outsideDir, "target.txt");
    const junction = path.join(root, "esc");
    writeFileSync(outsideFile, "original", "utf-8");
    mkdirSync(path.join(outsideDir, "sub"));
    writeFileSync(path.join(outsideDir, "sub", "inner.txt"), "inner", "utf-8");
    execSync(`cmd /c mklink /J "${junction}" "${outsideDir}"`);
    try {
      // The spawn applies the grant walk; the junction must be neither granted nor recursed into.
      const spawn = await sandboxed("Write-Output grant-check");
      expect(spawn.kind).toBe("ok");
      const sid = capabilitySidFor(root);
      expect(aclText(outsideFile)).not.toContain(sid);
      expect(aclText(path.join(outsideDir, "sub"))).not.toContain(sid);

      const overwrite = await sandboxed("[System.IO.File]::WriteAllText('.\\esc\\target.txt', 'pwn')");
      expect(overwrite.exitCode).not.toBe(0);
      expect(readFileSync(outsideFile, "utf-8")).toBe("original");

      const createInSub = await sandboxed("[System.IO.File]::WriteAllText('.\\esc\\sub\\new.txt', 'x')");
      expect(createInSub.exitCode).not.toBe(0);
      expect(existsSync(path.join(outsideDir, "sub", "new.txt"))).toBe(false);
    } finally {
      // Remove the junction itself; deleting the root recursively must not walk it.
      execSync(`cmd /c rmdir "${junction}"`);
      rmSync(outsideDir, { recursive: true, force: true });
    }
  }, 300_000);

  it("keeps double-quoted commands intact through the helper payload", async () => {
    // The payload travels as a JSON argument to `powershell -File`; a mangled
    // double quote would make ConvertFrom-Json fail and fail every quoted command.
    const result = await sandboxed('Write-Output "quoted value"');
    expect(result.kind).toBe("ok");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("quoted value");
  }, 120_000);

  it("redirects child TEMP/TMP into the writable root", async () => {
    const result = await sandboxed("Write-Output $env:TEMP");
    expect(result.kind).toBe("ok");
    expect(result.stdout.trim().toLowerCase()).toBe(path.join(root, ".sandbox-tmp").toLowerCase());
  }, 120_000);

  it("kills the whole sandboxed tree on timeout (kill-on-close job)", async () => {
    const started = Date.now();
    const result = await sandboxed("Start-Sleep -Seconds 60", 1);
    expect(result.kind).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 60_000);

  it("surfaces sandbox setup failures on background jobs", async () => {
    const job = spawnBackground({
      argv: ["powershell.exe", ...WIN32_PS_ARGS, "Write-Output never"],
      cwd: root,
      sandbox: { writableRoots: [path.join(root, "missing-root")] },
    });
    for (let i = 0; i < 200 && job.alive(); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(job.exitCode()).not.toBeNull();
    expect(job.sandboxSetupFailure()).toContain("sandbox setup failed");
    expect(job.output()).not.toContain("never");
  }, 120_000);

  it("fails closed with an authenticated error when setup is impossible", async () => {
    const result = await runProcess({
      argv: ["powershell.exe", ...WIN32_PS_ARGS, "Write-Output never"],
      cwd: root,
      timeoutSeconds: 60,
      sandbox: { writableRoots: [path.join(root, "missing-root")] },
    });
    expect(result.kind).toBe("error");
    expect(result.errorMessage).toContain("sandbox setup failed");
    expect(result.stdout).not.toContain("never");
  }, 120_000);
});
