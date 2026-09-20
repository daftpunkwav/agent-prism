/**
 * @file task-templates-ablation test
 * @description Locks the ablation task templates for the new comparison dimensions.
 */
import { describe, expect, it } from "vitest";
import { DimensionIdSchema } from "@agentprism/contracts";
import { getTemplate, listTemplates } from "../src/task-templates.js";
import { judgeAnswers } from "@agentprism/evaluation";

const ABLATION_IDS = ["mcp_fs_probe", "skill_commit_format", "orchestration_two_files", "loop_prime_race", "context_long_tail", "terse_factorial"] as const;

describe("ablation templates", () => {
  it("registers one scored template per new comparison dimension", () => {
    for (const id of ABLATION_IDS) {
      const template = getTemplate(id);
      expect(template, `missing template ${id}`).toBeDefined();
      expect(template?.category).toBe("scored");
      expect(DimensionIdSchema.safeParse(template?.suggested_dimension).success).toBe(true);
      expect(template?.suggested_selections.length).toBeGreaterThanOrEqual(2);
    }
    expect(getTemplate("mcp_fs_probe")?.suggested_dimension).toBe("mcp");
    expect(getTemplate("terse_factorial")?.suggested_dimension).toBe("prompt");
    expect(getTemplate("skill_commit_format")?.suggested_dimension).toBe("skill");
    expect(getTemplate("orchestration_two_files")?.suggested_dimension).toBe("orchestration");
  });

  it("judges the ablation templates deterministically", () => {
    const skill = getTemplate("skill_commit_format");
    const loop = getTemplate("loop_prime_race");
    const tail = getTemplate("context_long_tail");
    expect(judgeAnswers({ a: "feat: add user login" }, skill!.judge)["a"]?.passed).toBe(true);
    expect(judgeAnswers({ a: "random words here" }, skill!.judge)["a"]?.passed).toBe(false);
    expect(judgeAnswers({ a: "46" }, loop!.judge)["a"]?.passed).toBe(true);
    expect(judgeAnswers({ a: "2000" }, tail!.judge)["a"]?.passed).toBe(true);
    const terse = getTemplate("terse_factorial");
    expect(judgeAnswers({ a: "355687428096000" }, terse!.judge)["a"]?.passed).toBe(true);
    expect(judgeAnswers({ a: "roughly 3.5e14" }, terse!.judge)["a"]?.passed).toBe(false);
    expect(listTemplates().filter((t) => t.category === "scored").length).toBeGreaterThanOrEqual(14);
  });
});
