/**
 * @file context-instructions/digest
 * @description Content hashing and change detection for instruction layers.
 *
 * Responsibilities:
 * - Hash layer sets into stable digests (FNV-1a, dependency-free)
 * - Compare digests so re-rendering is pay-as-you-go, not per-turn
 *
 * Digests cover names + bodies + source precedence: any edit, addition,
 * removal, or reorder changes the digest. Hashing is structural (no mtimes),
 * so identical content always yields identical digests across processes.
 */

import type { InstructionLayer } from "./sources.js";

/** 32-bit FNV-1a over UTF-16 code units (fast, dependency-free, stable). */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Stable digest of an ordered layer set (names, bodies, and sources). */
export function digestLayers(layers: readonly InstructionLayer[]): string {
  const canonical = layers
    .map((layer) => `${layer.source}:${layer.name}:${layer.body.length}:${fnv1a(layer.body)}`)
    .join("\n");
  return fnv1a(canonical);
}

/** Change report between two digests (null when identical). */
export function diffDigest(before: string, after: string): { changed: boolean; before: string; after: string } {
  return { changed: before !== after, before, after };
}
