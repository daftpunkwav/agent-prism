/**
 * @file context-instructions/state
 * @description Held instruction state with refresh-on-change semantics.
 *
 * Responsibilities:
 * - Cache loaded layers plus their digest behind one handle
 * - Reload from the file access only when the caller asks, reporting changes
 *
 * The state never watches the filesystem itself (no timers, no watchers):
 * the host refreshes at turn boundaries or on explicit invalidation and gets
 * a changed flag plus the fresh render. All IO funnels through the injected
 * InstructionFileAccess, so tests and runtimes share the exact code path.
 */

import { digestLayers, diffDigest } from "./digest.js";
import { renderInstructions, type RenderedInstructions } from "./render.js";
import { loadInstructionLayers, type InstructionFileAccess, type InstructionLayer } from "./sources.js";

export interface InstructionRefreshOptions {
  repoFiles?: readonly string[];
  workspaceFiles?: readonly string[];
  budget?: number;
}

export interface InstructionSnapshot {
  layers: InstructionLayer[];
  digest: string;
  rendered: RenderedInstructions;
  skipped: number;
}

/** Held instruction state: load once, refresh explicitly, render cheaply. */
export class InstructionState {
  private snapshot: InstructionSnapshot | null = null;

  /** Current snapshot (null before the first refresh). */
  current(): InstructionSnapshot | null {
    return this.snapshot;
  }

  /**
   * Reloads layers and re-renders.
   * @returns Snapshot plus whether the digest changed since the last refresh.
   */
  refresh(files: InstructionFileAccess, options: InstructionRefreshOptions = {}): { snapshot: InstructionSnapshot; changed: boolean } {
    const { layers, skipped } = loadInstructionLayers(files, {
      repoFiles: options.repoFiles,
      workspaceFiles: options.workspaceFiles,
    });
    const digest = digestLayers(layers);
    const rendered = renderInstructions(layers, options.budget);
    const snapshot: InstructionSnapshot = { layers, digest, rendered, skipped };
    const before = this.snapshot?.digest;
    this.snapshot = snapshot;
    return {
      snapshot,
      changed: before === undefined ? true : diffDigest(before, digest).changed,
    };
  }

  /** Drops the cached snapshot (forces changed=true on the next refresh). */
  invalidate(): void {
    this.snapshot = null;
  }
}
