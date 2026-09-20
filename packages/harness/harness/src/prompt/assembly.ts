/**
 * @file assembly
 * @description Prompt assembly: initial messages and system/user composition.
 *
 * Responsibilities:
 * - Build the initial LlmMessage list
 * - Compose system/user prompts including cwd and workspace retrieval
 */

import type { ChatMessage, LlmMessage, MemoryRecallResult } from "@agentprism/contracts";
import { parseMentions, resolveMentionBlock, type MentionFileSystem } from "@agentprism/context-mentions";
import { formatRetrievedSnippets } from "../context/messages.js";
import { queryWorkspaceSnippets } from "../memory/rag.js";
import { buildPromptParts } from "./prompt-builder.js";
import { renderWorkspaceInstructions } from "./instructions.js";
import { mcpPolicyNote, orchestrationNote, skillPolicyNote } from "./policy-sections.js";
import type { AgentExecutionContext } from "../execution-context.js";

/** Max `@file` mentions resolved per prompt assembly. */
export const MENTION_RESOLVE_LIMIT = 10;

/** Max memory lines mounted into the system prompt (bounds context cost). */
export const MEMORY_BLOCK_LIMITS = { episodic: 3, semantic: 5 } as const;

/** Truncates one memory line so a single verbose lesson cannot flood the prompt. */
function truncateMemoryLine(line: string, maxChars = 300): string {
  const trimmed = line.trim().replace(/\s+/g, " ");
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 1)}…` : trimmed;
}

/**
 * Renders recalled cross-session memories as a prompt block.
 * Returns "" when there is nothing to mount (fail-closed to stateless).
 */
export function renderMemoryBlock(memory: MemoryRecallResult | undefined | null): string {
  if (memory === undefined || memory === null) return "";
  const lines: string[] = [];
  for (const entry of (memory.episodic ?? []).slice(0, MEMORY_BLOCK_LIMITS.episodic)) {
    const outcome = entry.success ? "succeeded" : "failed";
    const via = entry.keyActions.length > 0 ? ` (via ${entry.keyActions.slice(0, 6).join(", ")})` : "";
    const lesson = entry.lessons.trim() !== "" ? `: ${entry.lessons}` : "";
    lines.push(`- In a similar task "${entry.task}" the run ${outcome}${via}${lesson}`.trim());
  }
  for (const fact of (memory.semantic ?? []).slice(0, MEMORY_BLOCK_LIMITS.semantic)) {
    lines.push(`- Project convention: ${fact.subject} ${fact.predicate} ${fact.object}.`.trim());
  }
  if (lines.length === 0) return "";
  return `\n\n[Prior Experience & Relevant Memories]\n${lines.map((line) => truncateMemoryLine(line)).join("\n")}`;
}

/**
 * Builds the initial LlmMessage list: system + shared history + this turn's user.
 * Empty-text history entries are skipped.
 */
export function buildInitialMessages(system: string, user: string, history?: ChatMessage[]): LlmMessage[] {
  const messages: LlmMessage[] = [{ role: "system", content: system }];
  for (const message of history ?? []) {
    const text = (message.content ?? "").trim();
    if (text === "") continue;
    messages.push(
      message.role === "assistant"
        ? { role: "assistant", content: text }
        : { role: "user", content: text },
    );
  }
  messages.push({ role: "user", content: user });
  return messages;
}

/**
 * Assembles the system/user prompts (including cwd and real workspace retrieval for
 * vector/hybrid). Matches legacy behavior: retrieved snippets append to the user
 * text as fenced content.
 */
export function buildSystemUser(context: AgentExecutionContext): { system: string; user: string } {
  const { config, question, workspace } = context;
  const parts = buildPromptParts({
    question,
    profile: config.prompt_profile,
    reasoning: config.reasoning,
    harness: config.harness,
    context: config.context,
    cwd: workspace.cwd(),
    now: context.clock.now(),
  });

  let user = parts.user;
  // `@file` mentions in the question resolve against the column workspace
  // (capped: mentions are author-controlled, but workspaces are not).
  const mentions = parseMentions(question).slice(0, MENTION_RESOLVE_LIMIT);
  if (mentions.length > 0) {
    const block = resolveMentionBlock(workspace.fs as unknown as MentionFileSystem, mentions);
    if (block !== "") user += `\n\n${block}`;
  }
  if (config.context === "vector" || config.context === "hybrid") {
    const snippets = queryWorkspaceSnippets(context.rag, workspace, question.trim());
    const fenced = formatRetrievedSnippets(snippets);
    if (fenced !== "") {
      user += `\n\n${fenced}`;
    }
  }
  let system = parts.system;
  const policy = context.config as Record<string, unknown>;
  const mcpPolicy = typeof policy["mcp_policy"] === "string" ? (policy["mcp_policy"] as string) : "off";
  const skillPolicy = typeof policy["skill_policy"] === "string" ? (policy["skill_policy"] as string) : "on_demand";
  const orchestration = typeof policy["orchestration"] === "string" ? (policy["orchestration"] as string) : "direct";
  const memoryPolicy = typeof policy["memory"] === "string" ? (policy["memory"] as string) : "none";
  system += mcpPolicyNote(mcpPolicy);
  system += skillPolicyNote(skillPolicy);
  system += orchestrationNote(orchestration);
  if (memoryPolicy !== "none") {
    system += renderMemoryBlock(context.memoryRecall);
  }
  const preload = (context.skillPreloadBlock ?? "").trim();
  if (skillPolicy === "preloaded" && preload !== "") {
    system += `\n\n${preload}`;
  }
  // Workspace instruction layers (AGENTS.md): quiet when no file exists.
  const instructions = renderWorkspaceInstructions(workspace.fs);
  if (instructions !== "") {
    system += `\n\n${instructions}`;
  }
  const override = (context.systemPromptOverride ?? "").trim();
  if (override !== "") {
    system = override;
  }
  const feedback = (context.verificationFeedback ?? "").trim();
  if (feedback !== "") {
    system += `\n\n[Previous reflection]\n${feedback}`;
  }
  const notices = (context.notices ?? []).map((notice) => notice.trim()).filter((notice) => notice !== "");
  if (notices.length > 0) {
    system += `\n\n${notices.map((notice) => `[Session update] ${notice}`).join("\n\n")}`;
  }
  return { system, user };
}
