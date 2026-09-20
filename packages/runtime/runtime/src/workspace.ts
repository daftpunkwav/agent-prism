/**
 * @file workspace
 * @description Disk-backed workspaces with a TTL + LRU lifecycle registry.
 *
 * Responsibilities:
 * - Own one root directory per Workspace bound to a single run
 * - Evict idle workspaces under TTL and LRU bounds
 * - Protect in-run workspaces from eviction
 */

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { cp } from "node:fs/promises";
import path from "node:path";
import type { Clock } from "@agentprism/contracts";
import { isSafeWorkspaceSegment } from "@agentprism/contracts";
import { ScopedFileSystem } from "@agentprism/environment";

/** Disk workspace: a root directory exclusively owned by one run instance. */
export class Workspace {
  readonly name: string;
  readonly root: string;
  readonly fs: ScopedFileSystem;
  readonly createdAt: string;

  constructor(name: string, root: string, clock: Clock) {
    this.name = name;
    this.root = root;
    this.fs = new ScopedFileSystem(root);
    mkdirSync(root, { recursive: true });
    this.createdAt = new Date(clock.now()).toISOString();
  }

  cwd(): string {
    return this.root;
  }
}

export const DEFAULT_MAX_WORKSPACES = 32;
export const DEFAULT_TTL_SECONDS = 3600;

/** Workspace lifecycle management: TTL + LRU eviction + in-run protection. */
export class WorkspaceRegistry {
  private readonly workspaces = new Map<string, Workspace>();
  private readonly lastAccess = new Map<string, number>();
  /**
   * In-run protection counts, not flags: nested executions (subagents) re-protect
   * the workspace they share with their parent, so one unprotect must not release
   * a still-running holder early. Eviction treats count > 0 as protected.
   */
  private readonly protectedNames = new Map<string, number>();
  /**
   * Ownership pins (thread workspaces): exempt from TTL and LRU eviction for as
   * long as the owner lives. Pins still count toward the size quota — a full
   * registry of pins makes new workspace creation fail loudly, never evict.
   */
  private readonly pinnedNames = new Set<string>();
  private readonly maxWorkspaces: number;
  private readonly ttlSeconds: number;
  private readonly runsRoot: string;
  private readonly clock: Clock;
  /** TTL/LRU time source: monotonic clock (immune to system clock adjustments), injectable fake clock for tests. */
  private readonly monotonicNow: () => number;
  /** Built-in idle window (seconds) before LRU eviction prefers a workspace. */
  private static readonly DEFAULT_LRU_ACTIVE_WINDOW = 300;
  /** How long inactive before preferred eviction (seconds). */
  private readonly lruActiveWindowSeconds: number;

  constructor(options: {
    maxWorkspaces?: number;
    ttlSeconds?: number;
    /** Idle seconds before LRU eviction prefers a workspace (default 300). */
    lruActiveWindowSeconds?: number;
    runsRoot: string;
    /** Wall clock: only for the createdAt display label, never TTL/LRU timing. */
    clock: Clock;
    /** Monotonic clock (seconds); defaults to performance.now — a different epoch from the injected Clock, do not mix. */
    monotonicNow?: () => number;
  }) {
    // NaN-proof like Semaphore/CircuitBreaker: Math.max(1, NaN) is NaN, which would
    // silently disable the quota (size >= NaN is always false) and leak memory.
    const maxWorkspaces = options.maxWorkspaces ?? DEFAULT_MAX_WORKSPACES;
    this.maxWorkspaces = Number.isFinite(maxWorkspaces) ? Math.max(1, Math.trunc(maxWorkspaces)) : DEFAULT_MAX_WORKSPACES;
    this.ttlSeconds = Math.max(0.05, options.ttlSeconds ?? DEFAULT_TTL_SECONDS);
    this.lruActiveWindowSeconds = options.lruActiveWindowSeconds ?? WorkspaceRegistry.DEFAULT_LRU_ACTIVE_WINDOW;
    this.runsRoot = options.runsRoot;
    this.clock = options.clock;
    this.monotonicNow = options.monotonicNow ?? defaultMonotonicNow;
    mkdirSync(this.runsRoot, { recursive: true });
  }

  /** Marks as in-progress; excluded from TTL/LRU reclamation (reentrant: nested holders stack). */
  protect(name: string): void {
    this.protectedNames.set(name, (this.protectedNames.get(name) ?? 0) + 1);
  }

  /** Releases one protection hold; extra calls are no-ops (never negative). */
  unprotect(name: string): void {
    const count = this.protectedNames.get(name) ?? 0;
    if (count <= 1) this.protectedNames.delete(name);
    else this.protectedNames.set(name, count - 1);
  }

  /** Current protection holds (0 when unprotected); exposed for nesting tests. */
  protectedCount(name: string): number {
    return this.protectedNames.get(name) ?? 0;
  }

  /**
   * Pins a workspace against TTL/LRU eviction (idempotent; pinning a name that
   * is not resident yet is legal — rehydration re-registers it). Size quota
   * still applies to creation.
   */
  pin(name: string): void {
    this.pinnedNames.add(name);
  }

  /** Releases an ownership pin; extra calls are no-ops. */
  unpin(name: string): void {
    this.pinnedNames.delete(name);
  }

  /** True while the workspace is excluded from eviction (protected or pinned). */
  private isEvictable(name: string): boolean {
    return !this.isProtected(name) && !this.pinnedNames.has(name);
  }

  /** True while at least one holder keeps the workspace out of reclamation. */
  private isProtected(name: string): boolean {
    return (this.protectedNames.get(name) ?? 0) > 0;
  }

  create(name: string, runId?: string): Workspace {
    const root = path.join(this.runsRoot, runId || "default", name);
    // Containment check is the enforcement here (names are not separately sanitized in create); assert the target stays inside runsRoot (also covers runId escapes).
    // Validate before any eviction: a rejected create must never delete live workspaces.
    const resolvedRoot = path.resolve(root);
    const resolvedRunsRoot = path.resolve(this.runsRoot);
    if (!resolvedRoot.startsWith(resolvedRunsRoot + path.sep)) {
      throw new Error(`Workspace path escapes runs root: ${name}`);
    }
    this.evictExpired();
    if (!this.workspaces.has(name) && this.workspaces.size >= this.maxWorkspaces) {
      const evicted = this.evictLru();
      // Fail-fast when everything is protected and nothing expired is evictable; never breach the quota.
      if (evicted === 0) {
        throw new Error(`Workspace quota full and nothing can be evicted: ${this.workspaces.size}/${this.maxWorkspaces}`);
      }
    }
    const workspace = new Workspace(name, root, this.clock);
    this.workspaces.set(name, workspace);
    this.lastAccess.set(name, this.monotonicNow());
    return workspace;
  }

  /** Fetches a workspace and refreshes its access time; undefined when absent. */
  get(name: string): Workspace | undefined {
    this.evictExpired();
    const workspace = this.workspaces.get(name);
    if (workspace !== undefined) {
      this.lastAccess.set(name, this.monotonicNow());
      return workspace;
    }
    const restored = this.rehydrateFromDisk(name);
    if (restored !== undefined) {
      this.lastAccess.set(name, this.monotonicNow());
    }
    return restored;
  }

  /**
   * Run-id owning a resident workspace (rehydrated lookups included); null when
   * the workspace is unknown to the registry. Powers per-run log directories:
   * the run layer appends observability streams beside the run's workspaces
   * without threading runId through every consumer.
   */
  runIdOf(name: string): string | null {
    const workspace = this.workspaces.get(name);
    if (workspace === undefined) return null;
    const parent = path.dirname(path.resolve(workspace.root));
    const resolvedRunsRoot = path.resolve(this.runsRoot);
    if (!parent.startsWith(resolvedRunsRoot + path.sep)) return null;
    return path.basename(parent);
  }

  /**
   * Per-run observability directory (`<runsRoot>/<runId>/_traces`), created on
   * demand. Sits at the runId level, so it is never reachable as a workspace
   * name and never visible to workspace file listing or agent tools.
   */
  traceDir(runId: string): string {
    if (!isSafeWorkspaceSegment(runId)) throw new Error(`Invalid run id for trace dir: ${runId}`);
    const dir = path.join(this.runsRoot, runId, "_traces");
    const resolvedDir = path.resolve(dir);
    const resolvedRunsRoot = path.resolve(this.runsRoot);
    if (!resolvedDir.startsWith(resolvedRunsRoot + path.sep)) {
      throw new Error(`Trace dir escapes runs root: ${runId}`);
    }
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * Reattaches a workspace that still exists on disk after a process restart
   * (in-memory map is empty, directories under runsRoot remain).
   */
  private rehydrateFromDisk(name: string): Workspace | undefined {
    if (!isSafeWorkspaceSegment(name)) return undefined;
    let runIds: string[];
    try {
      runIds = readdirSync(this.runsRoot);
    } catch {
      return undefined;
    }
    const resolvedRunsRoot = path.resolve(this.runsRoot);
    for (const runId of runIds) {
      if (!isSafeWorkspaceSegment(runId)) continue;
      const root = path.join(this.runsRoot, runId, name);
      const resolvedRoot = path.resolve(root);
      if (!resolvedRoot.startsWith(resolvedRunsRoot + path.sep)) continue;
      if (!existsSync(resolvedRoot)) continue;
      try {
        if (!statSync(resolvedRoot).isDirectory()) continue;
      } catch {
        continue;
      }
      if (!this.workspaces.has(name) && this.workspaces.size >= this.maxWorkspaces) {
        if (this.evictLru() === 0) return undefined;
      }
      const workspace = new Workspace(name, resolvedRoot, this.clock);
      this.workspaces.set(name, workspace);
      return workspace;
    }
    return undefined;
  }

  /**
   * Clones an existing workspace directory into a new workspace (fork/branch):
   * byte-for-byte copy so the two trees diverge independently. The source must
   * be idle (not protected by a live run) and the new name must be free. The
   * copy is async and honors the same quota/eviction discipline as create().
   *
   * The copy stages into a sibling directory and renames into place, so a
   * partially copied tree is never registered and never visible under the
   * clone name; the source stays protected against eviction for the whole
   * copy, because an eviction landing mid-copy would delete the tree under it.
   *
   * @param sourceName Existing workspace segment (rehydrated from disk when needed).
   * @param newName Path-safe segment for the clone; must not exist yet.
   * @returns The newly registered clone.
   */
  async clone(sourceName: string, newName: string): Promise<Workspace> {
    if (!isSafeWorkspaceSegment(newName)) {
      throw new Error(`Invalid clone workspace name: ${newName}`);
    }
    if (this.isProtected(sourceName)) {
      throw new Error(`Source workspace is in use by a live run: ${sourceName}`);
    }
    const source = this.get(sourceName);
    if (source === undefined) {
      throw new Error(`Source workspace does not exist: ${sourceName}`);
    }
    const resolvedRunsRoot = path.resolve(this.runsRoot);
    // The clone lands beside its source (same run-id grouping); the containment
    // check mirrors create() so a crafted name cannot escape the runs root.
    const cloneRoot = path.join(path.dirname(path.resolve(source.root)), newName);
    if (!cloneRoot.startsWith(resolvedRunsRoot + path.sep)) {
      throw new Error(`Workspace path escapes runs root: ${newName}`);
    }
    if (this.workspaces.has(newName) || existsSync(cloneRoot)) {
      throw new Error(`Clone workspace already exists: ${newName}`);
    }
    const stagingRoot = `${cloneRoot}.${process.pid}.partial`;
    rmRf(stagingRoot);
    this.evictExpired();
    if (this.workspaces.size >= this.maxWorkspaces && this.evictLru() === 0) {
      throw new Error(`Workspace quota full and nothing can be evicted: ${this.workspaces.size}/${this.maxWorkspaces}`);
    }
    // The entry check only covers runs that were already active: hold the source
    // for the whole copy so eviction cannot reclaim it mid-copy.
    this.protect(sourceName);
    try {
      await cp(source.root, stagingRoot, { recursive: true });
    } catch (error) {
      discardStaging(stagingRoot);
      throw error;
    } finally {
      this.unprotect(sourceName);
    }
    // Registration is the point of no return for name and quota: re-check them
    // after the await so a concurrent create/clone cannot oversubscribe the
    // registry, and drop the staged copy instead of registering outside the bound.
    if (this.workspaces.has(newName) || existsSync(cloneRoot)) {
      discardStaging(stagingRoot);
      throw new Error(`Clone workspace already exists: ${newName}`);
    }
    this.evictExpired();
    if (this.workspaces.size >= this.maxWorkspaces && this.evictLru() === 0) {
      discardStaging(stagingRoot);
      throw new Error(`Workspace quota full and nothing can be evicted: ${this.workspaces.size}/${this.maxWorkspaces}`);
    }
    try {
      renameSync(stagingRoot, cloneRoot);
    } catch (error) {
      discardStaging(stagingRoot);
      throw error;
    }
    const workspace = new Workspace(newName, cloneRoot, this.clock);
    this.workspaces.set(newName, workspace);
    this.lastAccess.set(newName, this.monotonicNow());
    return workspace;
  }

  remove(name: string): void {
    const workspace = this.workspaces.get(name);
    this.workspaces.delete(name);
    this.lastAccess.delete(name);
    this.protectedNames.delete(name);
    if (workspace !== undefined) {
      try {
        rmRf(workspace.root);
      } catch (error) {
        // Do not block on deletion failure, but directory leaks must stay observable
        console.warn(`[runtime] Failed to delete workspace directory ${workspace.root}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  count(): number {
    return this.workspaces.size;
  }

  private evictExpired(): number {
    const now = this.monotonicNow();
    let removed = 0;
    for (const [name, ts] of this.lastAccess) {
      if (this.isEvictable(name) && now - ts > this.ttlSeconds) {
        this.remove(name);
        removed += 1;
      }
    }
    return removed;
  }

  private evictLru(need = 1): number {
    let removed = 0;
    const now = this.monotonicNow();
    while (removed < need && this.workspaces.size > 0) {
      const candidates = [...this.lastAccess.entries()].filter(([name]) => this.isEvictable(name));
      if (candidates.length === 0) break;
      const inactive = candidates.filter(([, ts]) => now - ts > this.lruActiveWindowSeconds);
      const pool = inactive.length > 0 ? inactive : candidates;
      const head = pool[0];
      if (head === undefined) break;
      const oldestEntry = pool.reduce((acc, entry) => (entry[1] < acc[1] ? entry : acc), head);
      this.remove(oldestEntry[0]);
      removed += 1;
    }
    return removed;
  }
}

function defaultMonotonicNow(): number {
  return performance.now() / 1000;
}

function rmRf(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Removes a staged clone copy after a failure. Never throws: cleanup failure
 * must not mask the clone error, and an orphaned staging directory is inert —
 * it is never registered and is reclaimed with the runs root.
 */
function discardStaging(dir: string): void {
  try {
    rmRf(dir);
  } catch (error) {
    console.warn(`[runtime] Failed to remove staged clone ${dir}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
