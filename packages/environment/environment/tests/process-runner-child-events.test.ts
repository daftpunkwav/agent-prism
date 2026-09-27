/**
 * @file process runner child-event tests
 * @description Locks the runProcess / spawnBackground / spawnPersistentShell control
 * flow against a fake child process: setup failures, output caps, kill escalation,
 * and sandbox handoff. Real subprocess behavior lives in process-runner.test.ts;
 * the branches here need a caller-controlled child (spawn throws, ignored SIGTERM,
 * late events) that a real OS process cannot produce on demand.
 */

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
// node:util is where the runner reads TextDecoder from; one build has no GBK table.
vi.mock("node:util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:util")>();
  class NoGbkDecoder extends actual.TextDecoder {
    constructor(label?: string, options?: TextDecoderOptions) {
      if (label === "gbk") throw new RangeError("no ICU");
      super(label, options);
    }
  }
  return { ...actual, TextDecoder: NoGbkDecoder };
});

const { spawn } = await import("node:child_process");
const spawnMock = vi.mocked(spawn);

const {
  SANDBOX_SETUP_SENTINEL,
  WorkspaceError,
  runProcess,
  setSandboxSpawnTransform,
  spawnBackground,
  spawnPersistentShell,
} = await import("@agentprism/environment");

/** Stand-in for a spawned child: the events the runner subscribes to, controllable by the test. */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter() as EventEmitter & { destroy: () => void };
  readonly stderr = new EventEmitter() as EventEmitter & { destroy: () => void };
  readonly stdin = { end: vi.fn(), write: vi.fn() };
  readonly pid = 4242;
  readonly unref = vi.fn();
  readonly signals: Array<string | undefined> = [];
  killThrows = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  constructor() {
    super();
    this.stdout.destroy = vi.fn();
    this.stderr.destroy = vi.fn();
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    if (this.killThrows) throw new Error("ESRCH");
    this.signals.push(typeof signal === "string" ? signal : undefined);
    return true;
  }

  out(text: string): void {
    this.stdout.emit("data", Buffer.from(text, "utf-8"));
  }

  err(text: string): void {
    this.stderr.emit("data", Buffer.from(text, "utf-8"));
  }

  /** The OS reports the direct child gone; stdio drain (close) follows later. */
  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = signal === null ? code : null;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = signal === null ? code : null;
    this.signalCode = signal;
    this.emit("close", code, signal);
  }

  asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess;
  }
}

let child: FakeChild;

beforeEach(() => {
  child = new FakeChild();
  spawnMock.mockReturnValue(child.asChildProcess());
});

afterEach(() => {
  setSandboxSpawnTransform(null);
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("runProcess spawn contract", () => {
  it("spawns without a shell, closes stdin, and returns both streams with the exit code", async () => {
    const pending = runProcess({ argv: ["node", "-e", "1"], cwd: "/work", timeoutSeconds: 30 });
    expect(spawnMock).toHaveBeenCalledWith("node", ["-e", "1"], {
      cwd: "/work",
      shell: false,
      windowsHide: true,
      env: expect.objectContaining({ PYTHONIOENCODING: "utf-8" }) as unknown,
    });
    // A command that reads stdin must hit EOF instead of waiting for input.
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
    child.out("out");
    child.err("err");
    child.close(2);
    await expect(pending).resolves.toEqual({ kind: "ok", stdout: "out", stderr: "err", exitCode: 2 });
  });

  it("maps a spawn throw that already carries a workspace message to errorMessage", async () => {
    spawnMock.mockImplementation(() => {
      throw new WorkspaceError("Error: OS write sandbox requires exactly one writable root, got 2");
    });
    const result = await runProcess({ argv: ["node"], cwd: "/work", timeoutSeconds: 30 });
    expect(result.kind).toBe("error");
    expect(result.errorMessage).toContain("exactly one writable root");
    // Only the type name is exposed for foreign errors, never the message.
    expect(result.errorName).toBeUndefined();
    expect(result.exitCode).toBeNull();
  });

  it("maps a generic spawn throw to the error type name", async () => {
    spawnMock.mockImplementation(() => {
      throw new TypeError("bad argv");
    });
    const result = await runProcess({ argv: [""], cwd: "/work", timeoutSeconds: 30 });
    expect(result).toMatchObject({ kind: "error", errorName: "TypeError", stdout: "", stderr: "" });
    expect(result.errorMessage).toBeUndefined();
  });

  it("kills the child instead of orphaning it when closing stdin fails", async () => {
    child.stdin.end.mockImplementation(() => {
      throw new Error("EPIPE");
    });
    const result = await runProcess({ argv: ["node"], cwd: "/work", timeoutSeconds: 30 });
    expect(child.signals).toEqual([undefined]);
    expect(result).toMatchObject({ kind: "error", errorName: "Error", exitCode: null });
  });
});

describe("runProcess output caps", () => {
  it("stops appending to a stream once the cap is reached", async () => {
    const pending = runProcess({ argv: ["node"], cwd: "/work", timeoutSeconds: 30 });
    // The cap is checked before appending, so the first chunk that reaches it lands whole.
    child.out("x".repeat(1_000_000));
    child.out("tail-stdout");
    child.err("y".repeat(1_000_000));
    child.err("tail-stderr");
    child.close(0);
    const result = await pending;
    expect(result.stdout).toBe("x".repeat(1_000_000));
    expect(result.stderr).toBe("y".repeat(1_000_000));
  });
});

describe("runProcess kill escalation", () => {
  it("SIGTERMs on the timeout and SIGKILLs a child that ignores it", async () => {
    vi.useFakeTimers();
    const pending = runProcess({ argv: ["node"], cwd: "/work", timeoutSeconds: 2 });
    vi.advanceTimersByTime(2_000);
    expect(child.signals).toEqual([undefined]);
    vi.advanceTimersByTime(3_000);
    expect(child.signals).toEqual([undefined, "SIGKILL"]);
    child.close(null, "SIGTERM");
    await expect(pending).resolves.toMatchObject({ kind: "timeout", exitCode: null });
  });

  it("reports an externally signalled child as an error, never as a timeout", async () => {
    const pending = runProcess({ argv: ["node"], cwd: "/work", timeoutSeconds: 30 });
    child.close(null, "SIGKILL");
    await expect(pending).resolves.toMatchObject({ kind: "error", errorName: "Signal SIGKILL" });
    expect(child.signals).toEqual([]);
  });

  it("treats an abort as a kill of its own, with its own escalation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = runProcess({ argv: ["node"], cwd: "/work", timeoutSeconds: 60, signal: controller.signal });
    controller.abort();
    expect(child.signals).toEqual([undefined]);
    vi.advanceTimersByTime(3_000);
    expect(child.signals).toEqual([undefined, "SIGKILL"]);
    child.close(null, "SIGTERM");
    await expect(pending).resolves.toMatchObject({ kind: "aborted", exitCode: null });
  });

  it("keeps the timeout outcome when an abort arrives after the timeout kill", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = runProcess({ argv: ["node"], cwd: "/work", timeoutSeconds: 2, signal: controller.signal });
    vi.advanceTimersByTime(2_000);
    controller.abort();
    // First killer wins: the timeout already owns this run.
    expect(child.signals).toEqual([undefined]);
    child.close(null, "SIGTERM");
    await expect(pending).resolves.toMatchObject({ kind: "timeout" });
  });

  it("lets a child that already exited keep its real outcome when aborted during stdio flush", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = runProcess({ argv: ["node"], cwd: "/work", timeoutSeconds: 60, signal: controller.signal });
    child.exit(0);
    controller.abort();
    expect(child.signals).toEqual([]);
    // The grace timer destroys the streams so a grandchild cannot hold close open.
    vi.advanceTimersByTime(100);
    expect(child.stdout.destroy).toHaveBeenCalledTimes(1);
    expect(child.stderr.destroy).toHaveBeenCalledTimes(1);
    child.close(0);
    await expect(pending).resolves.toMatchObject({ kind: "ok", exitCode: 0 });
  });

  it("does nothing when the timeout timer fires after the run settled", async () => {
    vi.useFakeTimers();
    const pending = runProcess({ argv: ["node"], cwd: "/work", timeoutSeconds: 2 });
    child.close(0);
    await expect(pending).resolves.toMatchObject({ kind: "ok" });
    vi.advanceTimersByTime(10_000);
    expect(child.signals).toEqual([]);
  });

  it("keeps the abort outcome when the timeout fires while the abort is in flight", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = runProcess({ argv: ["node"], cwd: "/work", timeoutSeconds: 2, signal: controller.signal });
    controller.abort();
    vi.advanceTimersByTime(2_000);
    expect(child.signals).toEqual([undefined]);
    child.close(null, "SIGTERM");
    await expect(pending).resolves.toMatchObject({ kind: "aborted" });
  });

  it("cancels the pending stdio-flush fallback when the child errors after exit", async () => {
    vi.useFakeTimers();
    const pending = runProcess({ argv: ["node"], cwd: "/work", timeoutSeconds: 60 });
    child.exit(0);
    child.emit("error", new Error("spawn failed"));
    await expect(pending).resolves.toMatchObject({ kind: "error", errorName: "Error" });
    vi.advanceTimersByTime(1_000);
    expect(child.stdout.destroy).not.toHaveBeenCalled();
  });

  it("lets close win over a flush timer the exit already started", async () => {
    vi.useFakeTimers();
    const pending = runProcess({ argv: ["node"], cwd: "/work", timeoutSeconds: 60 });
    child.exit(0);
    child.close(0);
    vi.advanceTimersByTime(1_000);
    expect(child.stdout.destroy).not.toHaveBeenCalled();
    // An exit reported after close must not restart the flush timer either.
    child.exit(0);
    vi.advanceTimersByTime(1_000);
    expect(child.stdout.destroy).not.toHaveBeenCalled();
    await expect(pending).resolves.toMatchObject({ kind: "ok", exitCode: 0 });
  });

  it("ignores events that arrive after the run already settled", async () => {
    const pending = runProcess({ argv: ["node"], cwd: "/work", timeoutSeconds: 30, signal: undefined });
    child.close(0);
    // Late events must not re-settle the promise or rewrite the outcome.
    child.emit("error", new Error("late"));
    child.close(1);
    await expect(pending).resolves.toMatchObject({ kind: "ok", exitCode: 0 });
  });
});

describe("runProcess sandbox handoff", () => {
  it("routes a sandboxed spawn through the transform with a fresh nonce", async () => {
    const seen: Array<{ argv: string[]; cwd: string; roots: readonly string[]; nonce: string }> = [];
    setSandboxSpawnTransform((argv, cwd, sandbox, nonce) => {
      seen.push({ argv, cwd, roots: sandbox.writableRoots, nonce });
      return ["sandbox-helper", ...argv];
    });
    const pending = runProcess({ argv: ["node", "-e", "1"], cwd: "/work", timeoutSeconds: 30, sandbox: { writableRoots: ["/root"] } });
    expect(spawnMock).toHaveBeenCalledWith("sandbox-helper", ["node", "-e", "1"], expect.anything());
    expect(seen[0]).toMatchObject({ cwd: "/work", roots: ["/root"] });
    expect(seen[0]?.nonce).toMatch(/^[a-z0-9]+$/);
    child.close(0);
    await expect(pending).resolves.toMatchObject({ kind: "ok" });
  });

  it("maps the authenticated helper failure to a process error, never to exit code 3", async () => {
    let nonce = "";
    setSandboxSpawnTransform((argv, _cwd, _sandbox, spawnNonce) => {
      nonce = spawnNonce;
      return argv;
    });
    const pending = runProcess({ argv: ["node"], cwd: "/work", timeoutSeconds: 30, sandbox: { writableRoots: ["/root"] } });
    child.err(`${SANDBOX_SETUP_SENTINEL}${nonce}: cannot create restricted token`);
    child.close(3);
    const result = await pending;
    expect(result.kind).toBe("error");
    expect(result.exitCode).toBeNull();
    expect(result.errorMessage).toBe("sandbox setup failed: cannot create restricted token");
  });

  it("keeps an unrelated exit 3 from a sandboxed run as the child's own exit code", async () => {
    setSandboxSpawnTransform((argv) => argv);
    const pending = runProcess({ argv: ["node"], cwd: "/work", timeoutSeconds: 30, sandbox: { writableRoots: ["/root"] } });
    child.err("the program itself failed");
    child.close(3);
    await expect(pending).resolves.toMatchObject({ kind: "ok", exitCode: 3 });
  });
});

describe("spawnBackground", () => {
  it("unrefs the child and reports lifecycle, exit code, and combined output", async () => {
    const job = spawnBackground({ argv: ["node"], cwd: "/work" });
    expect(child.unref).toHaveBeenCalledTimes(1);
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
    expect(job.pid).toBe(4242);
    child.out("out");
    child.err("err");
    // The exit code lands on exit, but output keeps flowing until close.
    child.exit(0);
    expect(job.exitCode()).toBe(0);
    // Output produced after exit still lands: only close ends the job.
    child.out("-late");
    child.close(0);
    expect(job.alive()).toBe(false);
    expect(job.output()).toBe("outerr-late");
    expect(job.sandboxSetupFailure()).toBeNull();
  });

  it("SIGKILLs a job that ignores SIGTERM, and stop is a no-op once closed", async () => {
    vi.useFakeTimers();
    const job = spawnBackground({ argv: ["node"], cwd: "/work" });
    job.kill();
    expect(child.signals).toEqual([undefined]);
    vi.advanceTimersByTime(3_000);
    expect(child.signals).toEqual([undefined, "SIGKILL"]);
    child.close(0);
    job.kill();
    expect(child.signals).toEqual([undefined, "SIGKILL"]);
    expect(job.alive()).toBe(false);
  });

  it("drops the kill escalation once the spawn errors, and survives a failed kill", async () => {
    vi.useFakeTimers();
    const job = spawnBackground({ argv: ["node"], cwd: "/work" });
    job.kill();
    child.emit("error", new Error("ENOENT"));
    vi.advanceTimersByTime(10_000);
    expect(child.signals).toEqual([undefined]);
    expect(job.alive()).toBe(false);
    const second = spawnBackground({ argv: ["node"], cwd: "/work" });
    child.killThrows = true;
    second.kill();
    expect(child.signals).toEqual([undefined]);
  });

  it("marks a job finished when the spawn itself errors", async () => {
    const job = spawnBackground({ argv: ["missing-binary"], cwd: "/work" });
    child.emit("error", new Error("ENOENT"));
    expect(job.alive()).toBe(false);
    expect(job.exitCode()).toBeNull();
    // A dead job ignores kill.
    job.kill();
    expect(child.signals).toEqual([]);
  });

  it("rethrows a transform refusal and wraps a foreign spawn failure", () => {
    setSandboxSpawnTransform(() => {
      throw new WorkspaceError("Error: OS write sandbox is only enforced on Windows; refusing to run unsandboxed");
    });
    expect(() => spawnBackground({ argv: ["node"], cwd: "/work", sandbox: { writableRoots: ["/root"] } })).toThrow(/only enforced on Windows/);
    spawnMock.mockImplementation(() => {
      throw new Error("bad cwd");
    });
    expect(() => spawnBackground({ argv: ["node"], cwd: "/missing" })).toThrow(/cannot start background job \(bad cwd\)/);
  });

  it("reports an authenticated setup failure through sandboxSetupFailure", () => {
    let nonce = "";
    setSandboxSpawnTransform((argv, _cwd, _sandbox, spawnNonce) => {
      nonce = spawnNonce;
      return argv;
    });
    const job = spawnBackground({ argv: ["node"], cwd: "/work", sandbox: { writableRoots: ["/root"] } });
    child.err(`${SANDBOX_SETUP_SENTINEL}${nonce}: token creation failed`);
    child.close(3);
    expect(job.sandboxSetupFailure()).toBe("sandbox setup failed: token creation failed");
    expect(job.exitCode()).toBe(3);
  });
});

describe("spawnPersistentShell off Windows", () => {
  let platform: PropertyDescriptor | undefined;

  beforeEach(() => {
    platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  });

  afterEach(() => {
    if (platform !== undefined) Object.defineProperty(process, "platform", platform);
  });

  it("starts a hermetic bash that reads commands from stdin", () => {
    const shell = spawnPersistentShell({ cwd: "/work" });
    expect(spawnMock).toHaveBeenCalledWith("bash", ["--noprofile", "--norc", "-s"], {
      cwd: "/work",
      shell: false,
      windowsHide: true,
      env: expect.objectContaining({ NO_PROXY: "*" }) as unknown,
    });
    expect(shell.pid).toBe(4242);
    expect(shell.alive()).toBe(true);
    shell.write("echo hi\n");
    expect(child.stdin.write).toHaveBeenCalledWith("echo hi\n");
    child.out("hi\n");
    child.err("warn\n");
    expect(shell.output()).toBe("hi\nwarn\n");
    shell.kill();
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
    expect(child.signals).toEqual([undefined]);
  });

  it("severs writes and writes-only after the shell closes", () => {
    const shell = spawnPersistentShell({ cwd: "/work" });
    child.emit("close", 0, null);
    expect(shell.alive()).toBe(false);
    expect(() => shell.write("echo hi\n")).toThrow(/persistent shell is closed/);
    // Kill on an already-finished shell leaves the finished state alone.
    shell.kill();
    expect(child.signals).toEqual([]);
  });

  it("reports a failed shell write and a failed start", () => {
    const shell = spawnPersistentShell({ cwd: "/work" });
    child.stdin.write.mockImplementation(() => {
      throw new Error("EPIPE");
    });
    expect(() => shell.write("echo hi\n")).toThrow(/shell write failed \(EPIPE\)/);
    spawnMock.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(() => spawnPersistentShell({ cwd: "/work" })).toThrow(/cannot start persistent shell \(ENOENT\)/);
  });

  it("drops the kill escalation when the shell closes first, and survives a failed kill", () => {
    vi.useFakeTimers();
    const shell = spawnPersistentShell({ cwd: "/work" });
    shell.kill();
    child.close(0);
    vi.advanceTimersByTime(10_000);
    expect(child.signals).toEqual([undefined]);
    const second = spawnPersistentShell({ cwd: "/work" });
    child.killThrows = true;
    second.kill();
    expect(child.signals).toEqual([undefined]);
  });

  it("escalates to SIGKILL when the shell ignores the term signal", () => {
    vi.useFakeTimers();
    const shell = spawnPersistentShell({ cwd: "/work" });
    shell.kill();
    vi.advanceTimersByTime(3_000);
    expect(child.signals).toEqual([undefined, "SIGKILL"]);
  });
});

describe("StreamDecoder without GBK support", () => {
  it("keeps lossy UTF-8 instead of dropping the stream", async () => {
    const Real = globalThis.TextDecoder;
    class NoGbk extends Real {
      constructor(label?: string, options?: TextDecoderOptions) {
        if (label === "gbk") throw new RangeError("no ICU");
        super(label, options);
      }
    }
    vi.stubGlobal("TextDecoder", NoGbk);
    try {
      const pending = runProcess({ argv: ["node"], cwd: "/work", timeoutSeconds: 30 });
      // GBK bytes are invalid UTF-8, so the strict decoder fails and the fallback is chosen.
      child.stdout.emit("data", Buffer.from("B1EDB4EFCABD", "hex"));
      child.close(0);
      const result = await pending;
      expect(result.stdout.length).toBeGreaterThan(0);
      expect(result.stdout).not.toContain("\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
