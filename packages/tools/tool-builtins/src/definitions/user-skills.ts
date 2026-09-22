/**
 * @file user-skills
 * @description User-managed skill layer: global skill directory, enable/disable store, CRUD.
 *
 * Responsibilities:
 * - Hold the module-level configuration (user skills dir + disabled-name store)
 *   injected by the server assembly; skill discovery consults it
 * - Create/update/delete user skills on disk as `<name>/SKILL.md`
 * - Persist the disabled-name list and expose the effective skill catalog
 *
 * Layering: this module stays inside tool-builtins and takes its filesystem and
 * persistence ports by injection, so it never imports the config package. The
 * server assembly wires real implementations; tests inject in-memory fakes.
 * Effective catalog order: bundled -> user dir (same-name override) -> runtime
 * workspace `.skills` (highest); disabled names filter out of the final result,
 * so a disabled skill disappears from both `skill list` and preloaded blocks.
 */

import {
  BUNDLED_SKILLS,
  SKILL_FILE,
  SKILL_NAME_RE,
  parseSkillFile,
  type Skill,
} from "./skills.js";

/** Filesystem port shared with the workspace view (subset used here). */
export interface UserSkillsFs {
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  deleteFile(path: string): void;
  /** Non-recursive listing of one directory's direct children (names, not paths). */
  listDir(dir: string): string[];
  exists(path: string): boolean;
}

/** Persistence port for the disabled-name list (AtomicJsonFile-compatible). */
export interface SkillsSettingsFile {
  read(): string[];
  write(value: string[]): void;
}

/** Module-level configuration; absent pieces degrade to bundled-only behavior. */
interface UserSkillsConfig {
  fs: UserSkillsFs | null;
  dir: string | null;
  settings: SkillsSettingsFile | null;
}

const config: UserSkillsConfig = { fs: null, dir: null, settings: null };

/**
 * Installs the user-skills layer configuration (called once by the assembly).
 * Passing null ports resets to bundled-only discovery (used by tests).
 */
export function configureUserSkills(options: {
  fs: UserSkillsFs | null;
  dir: string | null;
  settings: SkillsSettingsFile | null;
}): void {
  config.fs = options.fs;
  config.dir = options.dir;
  config.settings = options.settings;
}

/** Reads the disabled-name list; a failing store reads as empty (all enabled). */
export function disabledSkillNames(): string[] {
  if (config.settings === null) return [];
  try {
    const value = config.settings.read();
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/** One user skill on disk as `<dir>/<name>/SKILL.md`. */
function userSkillPath(name: string): string {
  if (config.dir === null) throw new Error("user skills directory is not configured");
  const normalized = SKILL_NAME_RE.test(name) ? name : "";
  if (normalized === "") throw new Error(`invalid skill name: ${JSON.stringify(name)}`);
  return `${config.dir}/${normalized}/${SKILL_FILE}`;
}

/** Renders one SKILL.md document (frontmatter description + body). */
function renderSkillFile(description: string, body: string): string {
  return `---\ndescription: ${description}\n---\n\n${body.trim()}\n`;
}

/** Lists installed user skill names (invalid directory entries are skipped). */
function listUserSkillNames(): string[] {
  if (config.fs === null || config.dir === null) return [];
  try {
    return config.fs.listDir(config.dir).filter((entry) => SKILL_NAME_RE.test(entry));
  } catch {
    return [];
  }
}

/** Loads one user skill; null when unreadable or malformed. */
function loadUserSkill(name: string): Skill | null {
  if (config.fs === null) return null;
  try {
    const parsed = parseSkillFile(config.fs.readFile(userSkillPath(name)));
    if (parsed === null) return null;
    return { name, ...parsed, source: "user" };
  } catch {
    return null;
  }
}

/** Creates one user skill; throws with an operator-readable message on defect. */
export function createUserSkill(input: { name: string; description: string; body: string }): Skill {
  if (config.fs === null || config.dir === null) throw new Error("user skills are not configured");
  const name = input.name.trim();
  if (!SKILL_NAME_RE.test(name)) throw new Error("name must be kebab-case (lowercase letters, digits, dashes)");
  const description = input.description.trim();
  if (description === "") throw new Error("description must not be empty");
  if (/\r?\n/.test(description)) {
    // The description is rendered into single-line SKILL.md frontmatter; a newline
    // would silently bleed its tail into the skill body on the next parse.
    throw new Error("description must be a single line");
  }
  const body = input.body.trim();
  if (body === "") throw new Error("body must not be empty");
  if (config.fs.exists(userSkillPath(name))) throw new Error(`skill ${JSON.stringify(name)} already exists`);
  config.fs.writeFile(userSkillPath(name), renderSkillFile(description, body));
  return { name, description, body, source: "user" };
}

/** Updates an existing user skill's description and/or body; bundled names reject. */
export function updateUserSkill(
  name: string,
  patch: { description?: string; body?: string },
): Skill {
  if (config.fs === null) throw new Error("user skills are not configured");
  const existing = BUNDLED_SKILLS.find((skill) => skill.name === name);
  if (existing !== undefined) throw new Error("bundled skills are read-only");
  const current = loadUserSkill(name);
  if (current === null) throw new Error(`unknown user skill ${JSON.stringify(name)}`);
  const description = (patch.description ?? current.description).trim();
  if (description === "") throw new Error("description must not be empty");
  if (/\r?\n/.test(description)) throw new Error("description must be a single line");
  const body = (patch.body ?? current.body).trim();
  if (body === "") throw new Error("body must not be empty");
  config.fs.writeFile(userSkillPath(name), renderSkillFile(description, body));
  return { name, description, body, source: "user" };
}

/** Deletes a user skill; bundled skills reject with a clear error. */
export function deleteUserSkill(name: string): void {
  if (config.fs === null) throw new Error("user skills are not configured");
  if (BUNDLED_SKILLS.some((skill) => skill.name === name)) {
    throw new Error("bundled skills are read-only");
  }
  const path = userSkillPath(name);
  if (!config.fs.exists(path)) throw new Error(`unknown user skill ${JSON.stringify(name)}`);
  config.fs.deleteFile(path);
  config.settings?.write(disabledSkillNames().filter((entry) => entry !== name));
}

/** Sets one skill's enabled flag (persisted; applies to bundled and user skills). */
export function setSkillEnabled(name: string, enabled: boolean): void {
  if (config.settings === null) throw new Error("skill settings are not configured");
  if (!SKILL_NAME_RE.test(name)) throw new Error(`invalid skill name: ${JSON.stringify(name)}`);
  const disabled = new Set(disabledSkillNames());
  if (enabled) disabled.delete(name);
  else disabled.add(name);
  config.settings.write([...disabled].sort());
}

/**
 * The effective skill catalog: bundled -> user dir -> runtime workspace merge,
 * disabled names filtered out. Shared by the `skill` tool and preloaded blocks.
 */
export function effectiveSkills(
  readWorkspaceFile: (path: string) => string,
  listWorkspaceFiles: (dir: string) => string[],
): { skills: Skill[]; skipped: number } {
  const merged = new Map<string, Skill>();
  for (const skill of BUNDLED_SKILLS) merged.set(skill.name, skill);
  for (const name of listUserSkillNames()) {
    const skill = loadUserSkill(name);
    if (skill !== null) merged.set(name, skill);
  }
  let skipped = 0;
  let entries: string[];
  try {
    entries = listWorkspaceFiles(".skills");
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    const parts = entry.split("/");
    if (parts.length !== 3 || parts[0] !== ".skills" || parts[2] !== SKILL_FILE) continue;
    const name = parts[1] ?? "";
    if (!SKILL_NAME_RE.test(name)) {
      skipped += 1;
      continue;
    }
    let text: string;
    try {
      text = readWorkspaceFile(entry);
    } catch {
      skipped += 1;
      continue;
    }
    const parsed = parseSkillFile(text);
    if (parsed === null) {
      skipped += 1;
      continue;
    }
    merged.set(name, { name, ...parsed, source: "workspace" });
  }
  const disabled = new Set(disabledSkillNames());
  const skills = [...merged.values()]
    .filter((skill) => !disabled.has(skill.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { skills, skipped };
}

/** Administrative listing (settings view): every known skill with its enabled flag. */
export function listSkillsForSettings(): Array<Skill & { enabled: boolean }> {
  const merged = new Map<string, Skill>();
  for (const skill of BUNDLED_SKILLS) merged.set(skill.name, skill);
  for (const name of listUserSkillNames()) {
    const skill = loadUserSkill(name);
    if (skill !== null) merged.set(name, skill);
  }
  const disabled = new Set(disabledSkillNames());
  return [...merged.values()]
    .map((skill) => ({ ...skill, enabled: !disabled.has(skill.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
