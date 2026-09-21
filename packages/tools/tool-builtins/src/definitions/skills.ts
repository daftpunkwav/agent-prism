/**
 * @file tools/skills
 * @description Bundled skill library and workspace skill loading.
 *
 * Responsibilities:
 * - Ship repo-derived expert runbooks as embedded skills (no build-step assets)
 * - Discover workspace `.skills/<name>/SKILL.md` overrides (workspace wins)
 * - Validate skill names with the DSH kebab-case grammar
 *
 * Localized DSH skill catalog (without the cordis/session machinery): skills are
 * loaded on demand through the `skill` tool, never auto-injected, so context
 * stays lean. Bodies are embedded as string constants instead of .md assets on
 * purpose: tsc does not copy asset files to dist, and a copy step for two short
 * runbooks would be machinery without payoff. Content derives from AGENTS.md.
 */

export interface Skill {
  name: string;
  description: string;
  body: string;
  source: "bundled" | "workspace" | "user";
}

/** DSH skill-name grammar: kebab-case, shared so registries never drift. */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Directory inside the workspace holding project skills (each skill is one SKILL.md). */
export const WORKSPACE_SKILLS_DIR = ".skills";
export const SKILL_FILE = "SKILL.md";

/** Short description budget for list output (bodies stay full on read). */
const MAX_LIST_DESCRIPTION = 200;

const COMMIT_SKILL = `Conventional Commits for this repo. One commit does one thing.
Format: \`<type>: <subject>\` — type is feat/fix/docs/refactor/chore/test/perf;
subject is imperative, <= 50 chars, describes behavior (never internal phase codes).
Identity: daftpunkwav <daftpunk.wav@outlook.com> unless the project overrides it.
Branches: \`<type>/<kebab-case>\` (same types, e.g. feat/context-compaction).
Never commit debug leftovers, commented-out code, or unrelated drive-bys.`;

const REVIEW_SKILL = `Pre-flight checklist before marking work done in this repo.
1. Requirements met, every diff line traces to the request; no scope creep.
2. Verified: run the project checks (typecheck/tests/boundaries as touched);
   disclose what ran, failed, or was skipped — failed means failed.
3. No TODO/commented-out/placeholder/debug leftovers; no unrelated or breaking changes.
4. User-visible changes have synced docs; assumptions and limits are disclosed.
5. Confirm before irreversible or externally-visible actions.`;

const PLAN_DISCIPLINE_SKILL = `Plan before acting on multi-step tasks.
1. Write the approach to .agent-plan.md via the plan tool (propose) before editing code.
2. Keep the plan sequenced: goal -> steps -> verification; update it when the approach changes.
3. Read the plan back when resuming; clear it when the task pivots.
Plans are durable and reviewable post-hoc; they never block on human approval in this runtime.`;

const GOAL_DISCIPLINE_SKILL = `Track the session objective explicitly with the goal tool.
1. Set one objective with done criteria at the start (goal set).
2. Move it through active/paused/blocked/completed; blocking demands a reason.
3. Get the goal on handoffs (subagent/ralph_loop) so nested turns inherit intent.
Complements todo_write (steps) with the objective those steps serve.`;

const TOOL_HYGIENE_SKILL = `Tool hygiene for long agent runs.
1. Prefer read/glob/grep before edit; verify with run before declaring done.
2. Keep tool arguments small: paginate listings, cap search output, prune middles.
3. Never disable validation or swallow errors to fake success; report failed as failed.`;

/** Repo-shipped skills (source of truth: AGENTS.md; keep bodies in sync with it). */
export const BUNDLED_SKILLS: readonly Skill[] = [
  { name: "commit", description: "Repo commit-message and branch conventions", body: COMMIT_SKILL, source: "bundled" },
  { name: "review", description: "Repo done-checklist for pre-flight verification", body: REVIEW_SKILL, source: "bundled" },
  { name: "plan-discipline", description: "Durable plan-first discipline for multi-step work", body: PLAN_DISCIPLINE_SKILL, source: "bundled" },
  { name: "goal-discipline", description: "Explicit objective tracking across turns and handoffs", body: GOAL_DISCIPLINE_SKILL, source: "bundled" },
  { name: "tool-hygiene", description: "Lean tool use and honest failure reporting", body: TOOL_HYGIENE_SKILL, source: "bundled" },
];

/** Renders bundled skills as a preloaded prompt block (empty when none). */
export function renderBundledSkillsBlock(skills: readonly Skill[] = BUNDLED_SKILLS): string {
  if (skills.length === 0) return "";
  const lines = skills.map((skill) => `## ${skill.name}\n${skill.body.trim()}`);
  return `[Preloaded skills]\n${lines.join("\n\n")}`;
}

/** Parses `description:` frontmatter (`---` fenced) plus body; null when malformed. */
export function parseSkillFile(text: string): { description: string; body: string } | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const fence = lines.indexOf("---", 1);
  if (fence < 0) return null;
  let description = "";
  for (const line of lines.slice(1, fence)) {
    const match = line.match(/^description\s*:\s*(.+)$/);
    if (match !== null) description = match[1]?.trim() ?? "";
  }
  const body = lines.slice(fence + 1).join("\n").trim();
  if (description === "" || body === "") return null;
  return { description: description.slice(0, MAX_LIST_DESCRIPTION), body };
}
