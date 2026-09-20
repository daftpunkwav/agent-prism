/**
 * @file process runner tests
 * @description Covers runProcess decoding/cancellation and the background job/shell handles.
 *
 * Responsibilities:
 * - Still produce output and exit when a grandchild holds the pipes
 * - Pin UTF-8-first decoding with the GBK fallback, plus abort semantics
 * - Lock background job lifecycle, repeatable kill, and persistent shell state
 */

import { afterEach, describe, expect, it } from "vitest";
import { childProcessEnv, runProcess, splitShellCommand } from "@agentprism/environment";

/**
 * Direct child exits immediately while a grandchild inherits stdio and stays alive
 * (models writing `cmd &` is natural): close waits for all pipe writers to close,
 * and timeout kill only hits the direct child —
 * regression lock: runProcess must settle as soon as the direct child exits,
 * not wait for the grandchild. The grandchild sleeps 15s against the 10s
 * assertion ceiling: a healthy settle takes ~100ms and an unfixed run blocks
 * >=15s, so both directions have wide margins even on a loaded machine.
 */
const GRANDCHILD_SCRIPT =
  "const{spawn}=require('child_process');" +
  "spawn(process.execPath,['-e','setTimeout(()=>{},15000)'],{stdio:['inherit','inherit','inherit'],detached:true}).unref();" +
  "process.stdout.write('parent-done');";

describe("runProcess when a grandchild holds stdio pipes", () => {
  it("settles as soon as the direct child exits, without waiting for the grandchild (regression F-202)", async () => {
    const started = Date.now();
    const result = await runProcess({
      argv: [process.execPath, "-e", GRANDCHILD_SCRIPT],
      cwd: process.cwd(),
      // Kill budget only: the behavior lock is the elapsed assertion below.
      timeoutSeconds: 30,
    });
    const elapsed = Date.now() - started;
    expect(result.kind).toBe("ok");
    // Drain grace keeps already-produced output from being lost on force-destroy
    expect(result.stdout).toContain("parent-done");
    // Unfixed: close blocked by the 15s grandchild; fixed: settles ms after the direct child exits
    expect(elapsed).toBeLessThan(10_000);
  });
});

describe("runProcess output decoding", () => {
  it("decodes UTF-8 output as-is", async () => {
    const result = await runProcess({
      argv: [process.execPath, "-e", "process.stdout.write('表达式 ok')"],
      cwd: process.cwd(),
      timeoutSeconds: 15,
    });
    expect(result.stdout).toContain("表达式 ok");
  });

  it("falls back to GBK when the child emits non-UTF-8 bytes (PowerShell parse errors on Chinese Windows)", async () => {
    // GBK bytes (B1ED B4EF CABD) for the expected word below - invalid as UTF-8, so the decoder must switch.
    const result = await runProcess({
      argv: [process.execPath, "-e", "process.stdout.write(Buffer.from('B1EDB4EFCABD','hex'))"],
      cwd: process.cwd(),
      timeoutSeconds: 15,
    });
    expect(result.stdout).toContain("表达式");
  });
});

describe("runProcess cancellation", () => {
  it("pre-aborted signal resolves aborted without spawning", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runProcess({
      argv: [process.execPath, "-e", "process.exit(0)"],
      cwd: process.cwd(),
      timeoutSeconds: 5,
      signal: controller.signal,
    });
    expect(result.kind).toBe("aborted");
  });

  it("mid-run abort kills the child and reports aborted (never waits for the timeout)", async () => {
    const controller = new AbortController();
    const pending = runProcess({
      argv: [process.execPath, "-e", "setTimeout(()=>{},30000)"],
      cwd: process.cwd(),
      timeoutSeconds: 60,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 200);
    const started = Date.now();
    const result = await pending;
    expect(result.kind).toBe("aborted");
    // Abort lands at ~200ms; even a heavily loaded machine settles far below
    // the 30s child sleep, so this ceiling only trips on a real regression.
    expect(Date.now() - started).toBeLessThan(15000);
  });
});

describe("runProcess outcome kinds", () => {
  it("reports an error kind when the executable does not exist", async () => {
    const result = await runProcess({
      argv: ["definitely-missing-binary-xyz", "--flag"],
      cwd: process.cwd(),
      timeoutSeconds: 10,
    });
    expect(result.kind).toBe("error");
    expect(result.errorName).toBeTruthy();
    expect(result.exitCode).toBeNull();
  });

  it("reports a timeout kind when the child outlives the budget", async () => {
    const result = await runProcess({
      argv: [process.execPath, "-e", "setTimeout(()=>{},30000)"],
      cwd: process.cwd(),
      timeoutSeconds: 1,
    });
    // The kill lands at ~1s; kind is timeout, never ok or error.
    expect(result.kind).toBe("timeout");
    expect(result.exitCode).toBeNull();
  });
});

describe("childProcessEnv", () => {
  const saved: Record<string, string | undefined> = {};
  const set = (key: string, value: string | undefined): void => {
    if (!(key in saved)) saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("inherits the base allowlist and pins encoding/proxy knobs", () => {
    set("PATH", "/bin");
    set("API_KEY", "sk-secret");
    set("HTTPS_PROXY", "http://proxy:8080");
    set("PYTHONIOENCODING", undefined);
    const env = childProcessEnv();
    expect(env["PATH"]).toBe("/bin");
    expect(env["API_KEY"]).toBeUndefined();
    expect(env["PYTHONIOENCODING"]).toBe("utf-8");
    expect(env["HTTP_PROXY"]).toBe("");
    expect(env["HTTPS_PROXY"]).toBe("");
    expect(env["NO_PROXY"]).toBe("*");
  });
});

describe("splitShellCommand", () => {
  it("strips quotes per posix rules and honors backslash escapes", () => {
    expect(splitShellCommand(`echo "a b" c`, true)).toEqual(["echo", "a b", "c"]);
    expect(splitShellCommand(`echo a\\ b`, true)).toEqual(["echo", "a b"]);
    // An empty quoted pair is a real (empty) argv token, as in shells.
    expect(splitShellCommand(`echo ''`, true)).toEqual(["echo", ""]);
  });

  it("keeps quote characters on non-posix (windows) tokenization", () => {
    expect(splitShellCommand(`echo "a b"`, false)).toEqual(["echo", `"a b"`]);
  });
});

describe("spawnBackground", () => {
  it("reports lifecycle, exit code, and combined output", async () => {
    const { spawnBackground } = await import("@agentprism/environment");
    const job = spawnBackground({
      argv: [process.execPath, "-e", "process.stdout.write('out');process.stderr.write('err');"],
      cwd: process.cwd(),
    });
    expect(job.alive()).toBe(true);
    for (let i = 0; i < 100 && job.alive(); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(job.alive()).toBe(false);
    expect(job.exitCode()).toBe(0);
    expect(job.output()).toContain("out");
    expect(job.output()).toContain("err");
  });

  it("kills a hanging job (kill is safe to repeat)", async () => {
    const { spawnBackground } = await import("@agentprism/environment");
    const job = spawnBackground({
      argv: [process.execPath, "-e", "setTimeout(()=>{},30000)"],
      cwd: process.cwd(),
    });
    expect(job.alive()).toBe(true);
    job.kill();
    job.kill();
    for (let i = 0; i < 100 && job.alive(); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(job.alive()).toBe(false);
  });
});

describe.skipIf(process.platform !== "win32")("spawnPersistentShell on Windows", () => {
  it("fails closed instead of spawning a non-POSIX shell", async () => {
    const { spawnPersistentShell } = await import("@agentprism/environment");
    // Windows callers must fail closed upstream; the message states the reason so a
    // caller can tell a platform refusal apart from a missing binary.
    expect(() => spawnPersistentShell({ cwd: process.cwd() })).toThrow(/persistent shell needs POSIX bash/);
  });
});

describe.skipIf(process.platform === "win32")("spawnPersistentShell", () => {
  it("keeps cd/export state across writes and reports output", async () => {
    const { spawnPersistentShell } = await import("@agentprism/environment");
    const shell = spawnPersistentShell({ cwd: process.cwd() });
    try {
      expect(shell.alive()).toBe(true);
      shell.write("export AP_PROBE=yes\n");
      shell.write("cd /tmp && echo got:$AP_PROBE\n");
      let text = "";
      for (let i = 0; i < 100 && !text.includes("got:yes"); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        text = shell.output();
      }
      expect(text).toContain("got:yes");
    } finally {
      shell.kill();
    }
    for (let i = 0; i < 100 && shell.alive(); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(shell.alive()).toBe(false);
  });
});
