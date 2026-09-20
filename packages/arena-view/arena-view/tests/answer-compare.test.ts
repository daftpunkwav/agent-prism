/**
 * @file answer-compare tests
 * @description Locks answer alignment, similarity scoring, and entity comparison.
 */
import { describe, expect, it } from "vitest";
import {
  alignAnswers,
  answerSimilarity,
  compareAnswerEntities,
  extractAnswerEntities,
  splitAnswerUnits,
} from "../src/answer-compare.js";

describe("splitAnswerUnits", () => {
  it("splits prose on sentence enders and keeps list items whole", () => {
    const units = splitAnswerUnits("第一段。第二句！\n- 列表项保持完整\n\n结尾");
    expect(units).toEqual(["第一段。", "第二句！", "- 列表项保持完整", "结尾"]);
  });

  it("drops blank lines and caps the unit count", () => {
    expect(splitAnswerUnits("a\n\n\nb")).toEqual(["a", "b"]);
    const many = splitAnswerUnits(Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n"));
    expect(many).toHaveLength(400);
  });
});

describe("alignAnswers", () => {
  it("marks shared units as same and the rest as column-exclusive", () => {
    const rows = alignAnswers("共用结论。\n只有 A 提到缓存。", "共用结论。\n只有 B 提到重试。");
    expect(rows).toEqual([
      { kind: "same", a: "共用结论。", b: "共用结论。" },
      { kind: "only-a", a: "只有 A 提到缓存。" },
      { kind: "only-b", b: "只有 B 提到重试。" },
    ]);
  });

  it("normalizes whitespace when matching units", () => {
    const rows = alignAnswers("same   line", "same line");
    expect(rows).toEqual([{ kind: "same", a: "same   line", b: "same line" }]);
  });

  it("aligns out-of-order shared units via LCS rather than position", () => {
    const rows = alignAnswers("头\n独有 A\n尾", "头\n尾");
    const kinds = rows.map((row) => row.kind);
    expect(kinds).toEqual(["same", "only-a", "same"]);
  });
});

describe("answerSimilarity", () => {
  it("scores 1 for identical, 0 for disjoint, and fractionally for partial overlap", () => {
    expect(answerSimilarity("a。b。", "a。b。")).toBe(1);
    expect(answerSimilarity("a。", "b。")).toBe(0);
    // shared 1 of max(2,2) units
    expect(answerSimilarity("a。b。", "a。c。")).toBeCloseTo(0.5);
    expect(answerSimilarity("", "")).toBe(1);
  });

  it("matches units as a multiset so repeats never cap a duplicate-free side below 1", () => {
    expect(answerSimilarity("a。a。", "a。a。")).toBe(1);
    // "x。" occurs 3 times vs 2: two occurrences are shared, the surplus is not.
    expect(answerSimilarity("x。x。x。", "x。x。")).toBeCloseTo(2 / 3);
  });
});

describe("extractAnswerEntities", () => {
  it("extracts paths, urls, commands and numbers without cross-contamination", () => {
    const entities = extractAnswerEntities(
      "运行 `npm run build` 后打开 src/index.ts，见 https://example.com/docs 与 README.md，共 3 个文件、耗时 120ms。",
    );
    expect(entities.commands).toContain("npm run build");
    expect(entities.paths).toContain("src/index.ts");
    expect(entities.paths).toContain("README.md");
    expect(entities.urls).toEqual(["https://example.com/docs"]);
    expect(entities.numbers).toContain("120ms");
  });

  it("does not absorb the following word as a unit suffix", () => {
    const entities = extractAnswerEntities("Found 25 steps at 4x speed and 50%, took 120ms");
    expect(entities.numbers).toEqual(["25", "4x", "50%", "120ms"]);
  });

  it("does not re-extract a path tail as a separate bare filename", () => {
    const entities = extractAnswerEntities("edit src/lib/utils.ts please");
    expect(entities.paths).toContain("src/lib/utils.ts");
    expect(entities.paths).not.toContain("utils.ts");
  });

  it("strips trailing sentence punctuation from urls", () => {
    const entities = extractAnswerEntities("see https://example.com/docs. and https://a.com/x, then");
    expect(entities.urls).toEqual(["https://example.com/docs", "https://a.com/x"]);
  });

  it("does not report a bare parent-directory reference as a path entity", () => {
    const entities = extractAnswerEntities("go to ../ for parent");
    expect(entities.paths).not.toContain("../");
  });

  it("stays linear on slash-free input of any length", () => {
    const hot = "a".repeat(50_000);
    const started = performance.now();
    extractAnswerEntities(hot);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("compareAnswerEntities", () => {
  it("reports consensus entities and column-exclusive ones", () => {
    const comparison = compareAnswerEntities([
      { label: "A", text: "修改了 src/app.ts 和 README.md，跑了 3 次测试" },
      { label: "B", text: "修改了 src/app.ts 和 tests/app.test.ts，跑了 5 次测试" },
    ]);
    expect(comparison.shared.paths).toContain("src/app.ts");
    expect(comparison.partial).toContainEqual({
      entity: "README.md",
      kind: "paths",
      columns: ["A"],
    });
    expect(comparison.partial).toContainEqual({
      entity: "tests/app.test.ts",
      kind: "paths",
      columns: ["B"],
    });
  });

  it("treats an entity present in every column as shared, not partial", () => {
    const comparison = compareAnswerEntities([
      { label: "A", text: "see docs/api.md" },
      { label: "B", text: "see docs/api.md" },
    ]);
    expect(comparison.shared.paths).toContain("docs/api.md");
    expect(comparison.partial).toHaveLength(0);
  });
});
