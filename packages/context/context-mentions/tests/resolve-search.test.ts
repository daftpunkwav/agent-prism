/**
 * @file resolve-search test
 * @description Locks mention resolution rendering and candidate ranking.
 */
import { describe, expect, it } from "vitest";
import { parseMentions } from "../src/grammar.js";
import { resolveMentionBlock, type MentionFileSystem } from "../src/resolve.js";
import { scoreCandidate, searchMentions } from "../src/search.js";

function fs(files: Record<string, string>): MentionFileSystem {
  return {
    readFile: (path: string) => {
      const hit = files[path];
      if (hit === undefined) throw new Error("missing");
      return hit;
    },
    listFiles: (dir: string) => (dir === "." || dir === "" ? Object.keys(files) : []),
    exists: (path: string) => path in files || path === ".",
  };
}

describe("resolveMentionBlock", () => {
  it("renders file hits and loud misses", () => {
    const block = resolveMentionBlock(fs({ "a.txt": "hello" }), parseMentions("read @a.txt and @gone.txt"));
    expect(block).toContain("[Referenced files]");
    expect(block).toContain("hello");
    expect(block).toContain("(missing: missing)");
    expect(block).toContain("reference material only");
  });

  it("rejects traversal loudly and returns empty for no mentions", () => {
    const block = resolveMentionBlock(fs({}), parseMentions("see @../evil"));
    expect(block).toContain("(missing: unresolvable)");
    expect(resolveMentionBlock(fs({}), [])).toBe("");
  });
});

describe("searchMentions", () => {
  const files = ["src/agent.ts", "src/agent-execution.ts", "tests/agent.test.ts", "README.md"];
  it("ranks prefix and boundary matches first, deterministically", () => {
    const out = searchMentions("agent", files);
    expect(out[0]!.path).toBe("src/agent.ts");
    expect(out.map((c) => c.path)).toContain("tests/agent.test.ts");
    expect(searchMentions("agent", files)).toEqual(out);
  });

  it("scores exact above fuzzy and zero for unrelated", () => {
    expect(scoreCandidate("a.ts", "a.ts")).toBeGreaterThan(scoreCandidate("a.ts", "ab.ts"));
    expect(scoreCandidate("zzz", "a.ts")).toBe(0);
    expect(scoreCandidate("", "a.ts")).toBeGreaterThan(0);
  });
});
