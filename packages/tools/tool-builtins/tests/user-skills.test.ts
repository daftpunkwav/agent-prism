// @vitest-environment jsdom
/**
 * @file user-skills tests
 * @description Locks the user skill layer: CRUD roundtrip, merge precedence,
 * disabled filtering, and preloaded-block respect.
 */
import { describe, expect, it } from "vitest";
import {
  configureUserSkills,
  createUserSkill,
  deleteUserSkill,
  disabledSkillNames,
  effectiveSkills,
  listSkillsForSettings,
  setSkillEnabled,
  updateUserSkill,
  type UserSkillsFs,
} from "../src/definitions/user-skills.js";
import { renderBundledSkillsBlock } from "../src/definitions/skills.js";

/** In-memory fs + settings file shared by the tests. */
function memoryEnv() {
  const files = new Map<string, string>();
  let disabled: string[] = [];
  const fs: UserSkillsFs = {
    readFile: (path) => {
      const value = files.get(path);
      if (value === undefined) throw new Error(`ENOENT ${path}`);
      return value;
    },
    writeFile: (path, content) => void files.set(path, content),
    deleteFile: (path) => void files.delete(path),
    listDir: (dir) =>
      [...files.keys()]
        .filter((path) => path.startsWith(`${dir}/`) && path.endsWith("/SKILL.md"))
        .map((path) => path.slice(dir.length + 1).split("/")[0] ?? ""),
    exists: (path) => files.has(path),
  };
  return {
    fs,
    files,
    settings: {
      read: () => [...disabled],
      write: (value: string[]) => {
        disabled = [...value];
      },
    },
    get disabled() {
      return disabled;
    },
  };
}

describe("user skills", () => {
  it("creates, lists, updates, and deletes a user skill", () => {
    const env = memoryEnv();
    configureUserSkills({ fs: env.fs, dir: "skills", settings: env.settings });
    createUserSkill({ name: "my-skill", description: "does things", body: "# steps\n1. do it" });
    expect(env.files.get("skills/my-skill/SKILL.md")).toContain("description: does things");
    const updated = updateUserSkill("my-skill", { body: "new body" });
    expect(updated.body).toBe("new body");
    expect(updated.description).toBe("does things");
    deleteUserSkill("my-skill");
    expect(env.files.has("skills/my-skill/SKILL.md")).toBe(false);
    configureUserSkills({ fs: null, dir: null, settings: null });
  });

  it("rejects invalid names, duplicates, empty fields, and bundled-name writes", () => {
    const env = memoryEnv();
    configureUserSkills({ fs: env.fs, dir: "skills", settings: env.settings });
    expect(() => createUserSkill({ name: "Bad_Name", description: "x", body: "y" })).toThrow(/kebab-case/);
    createUserSkill({ name: "dup", description: "x", body: "y" });
    expect(() => createUserSkill({ name: "dup", description: "x", body: "y" })).toThrow(/already exists/);
    expect(() => createUserSkill({ name: "ok", description: " ", body: "y" })).toThrow(/description/);
    expect(() => updateUserSkill("commit", { body: "nope" })).toThrow(/read-only/);
    expect(() => deleteUserSkill("review")).toThrow(/read-only/);
    expect(() => deleteUserSkill("missing")).toThrow(/unknown user skill/);
    configureUserSkills({ fs: null, dir: null, settings: null });
  });

  it("merges bundled, user, and workspace sources with later sources winning", () => {
    const env = memoryEnv();
    configureUserSkills({ fs: env.fs, dir: "skills", settings: env.settings });
    createUserSkill({ name: "commit", description: "user commit override", body: "user rules" });
    const workspaceRead = (path: string) =>
      path === ".skills/commit/SKILL.md" ? "---\ndescription: workspace commit\n---\n\nworkspace rules" : "";
    const { skills } = effectiveSkills(workspaceRead, () => [".skills/commit/SKILL.md"]);
    const commit = skills.find((skill) => skill.name === "commit");
    expect(commit?.source).toBe("workspace");
    expect(commit?.body).toBe("workspace rules");
    configureUserSkills({ fs: null, dir: null, settings: null });
  });

  it("filters disabled skills from discovery, settings listing, and preloaded blocks", () => {
    const env = memoryEnv();
    configureUserSkills({ fs: env.fs, dir: "skills", settings: env.settings });
    setSkillEnabled("review", false);
    setSkillEnabled("my-skill", true); // enabling an unknown name must not throw
    expect(disabledSkillNames()).toEqual(["review"]);
    expect(effectiveSkills(() => "", () => []).skills.map((skill) => skill.name)).not.toContain("review");
    const listing = listSkillsForSettings();
    expect(listing.find((skill) => skill.name === "review")?.enabled).toBe(false);
    expect(listing.find((skill) => skill.name === "commit")?.enabled).toBe(true);
    const visible = effectiveSkills(() => "", () => []).skills;
    const block = renderBundledSkillsBlock(visible);
    expect(block).not.toContain("## review");
    expect(block).toContain("## commit");
    setSkillEnabled("review", true);
    expect(disabledSkillNames()).toEqual([]);
    configureUserSkills({ fs: null, dir: null, settings: null });
  });
});
