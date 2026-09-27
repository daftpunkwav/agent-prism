/**
 * @file serial-queue
 * @description Per-key serial task queue for storage mutations.
 *
 * Responsibilities:
 * - Run queued tasks one at a time per key, in submission order
 * - Keep different keys independent, so one session never blocks another
 *
 * Store mutations read shared state, await IO, then write it back. Two of them
 * racing on the same key produce duplicated sequence numbers or lost updates
 * (both callers read `list.length` before either pushes). Wrapping the whole
 * read-modify-write in `run` makes each mutation atomic with respect to other
 * mutations on that key; a failed task rejects its own caller without stranding
 * the ones queued behind it.
 */

export class SerialQueue {
  private readonly tails = new Map<string, Promise<void>>();

  /** Runs `task` after every task already queued for `key`; rejects like `task`. */
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const tail = this.tails.get(key) ?? Promise.resolve();
    // The same handler on both settle paths: a rejected predecessor must not
    // swallow the next task (its own caller already saw the rejection).
    const result = tail.then(task, task);
    this.tails.set(
      key,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }
}
