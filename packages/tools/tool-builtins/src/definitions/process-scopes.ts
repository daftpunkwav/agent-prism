/**
 * @file process-scopes
 * @description Disposal seam for workspace-scoped OS resources.
 *
 * Responsibilities:
 * - Let the workspace lifecycle kill a workspace's background processes
 * - Keep one registry, so a future tool with process state joins by registering
 *
 * run_job and bash_session hold process-scoped maps keyed by workspace root.
 * Without disposal an evicted workspace leaves its shell and jobs running for
 * the life of the server, with their output buffers still resident; the host
 * wires `disposeWorkspaceProcesses` into the registry's release path.
 */

const DISPOSERS = new Set<(root: string) => void>();

/** Registers a disposer for one tool's per-workspace process scope. */
export function onWorkspaceDispose(dispose: (root: string) => void): void {
  DISPOSERS.add(dispose);
}

/**
 * Kills every process scope owned by one workspace root (idempotent).
 * Each disposer is isolated: one broken tool's cleanup must not strand the
 * other tools' resources nor abort the caller's eviction loop.
 */
export function disposeWorkspaceProcesses(root: string): void {
  for (const dispose of DISPOSERS) {
    try {
      dispose(root);
    } catch (error) {
      console.warn(`[process-scopes] Workspace disposer failed for ${root}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
