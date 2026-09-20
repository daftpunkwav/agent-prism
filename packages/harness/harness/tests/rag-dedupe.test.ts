/**
 * @file RAG dedupe tests
 * @description Covers first-round retrieve dedupe.
 *
 * Responsibilities:
 * - Suppress duplicate snippets in dedupeInitialInjection
 */

import { describe, expect, it } from "vitest";
import { createColumnSnippetRetriever, dedupeInitialInjection } from "@agentprism/harness";
import type { RagStoreCache } from "@agentprism/harness";

describe("dedupeInitialInjection first-round retrieve dedupe", () => {
  it("first call returns empty (snippets already injected into user by buildSystemUser); later calls pass through", () => {
    const calls: string[] = [];
    const retrieve = dedupeInitialInjection((query: string) => {
      calls.push(query);
      return `snippets:${query}`;
    });
    expect(retrieve("round-1 query")).toBe("");
    expect(retrieve("round-2 query")).toBe("snippets:round-2 query");
    expect(retrieve("round-3 query")).toBe("snippets:round-3 query");
    expect(calls).toEqual(["round-2 query", "round-3 query"]);
  });

  it("createColumnSnippetRetriever builds an independent wrapper each time: first-round skips do not cross columns", () => {
    // Wiring contract: all three drivers must call this on their own column-level run path,
    // each column holding an independent wrapper. If someone lifts it to a module-level
    // shared singleton, two builds return the same ref and the second column's first
    // retrieve is consumed by the first — this case locks unequal refs.
    // (Underlying retrieve goes through real queryWorkspaceSnippets on an empty cache,
    // returning "" — exactly simulating an empty workspace.)
    const fakeRag = { get: () => null } as unknown as RagStoreCache;
    const fakeWorkspace = { fs: {} as never };
    const retrieverA = createColumnSnippetRetriever(fakeRag, fakeWorkspace);
    const retrieverB = createColumnSnippetRetriever(fakeRag, fakeWorkspace);
    expect(retrieverA).not.toBe(retrieverB);
    // Each skips first round and passes through second (empty under empty cache, but wrappers are independent)
    expect(retrieverA("col-A first")).toBe("");
    expect(retrieverB("col-B first")).toBe("");
    expect(retrieverA("col-A second")).toBe("");
    expect(retrieverB("col-B second")).toBe("");
  });
});
