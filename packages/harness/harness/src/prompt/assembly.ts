/**
 * @file assembly
 * @description Prompt assembly: initial messages and system/user composition.
 *
 * Responsibilities:
 * - Build the initial LlmMessage list
 * - Compose system/user prompts including cwd and workspace retrieval
 * - Apply the active custom dimensions' prompt tags and prompt/memory hooks
 */

import type { ChatTurnMessage, LlmMessage, MemoryBlockLimits, MemoryRecallResult } from "@agentprism/contracts";
import { agentReplyDirective } from "@agentprism/contracts";
import { parseMentions, resolveMentionBlock, type MentionFileSystem } from "@agentprism/context-mentions";
import { applyCustomMemory, applyCustomPrompt, customPromptHint } from "../dimensions/custom-dimension-hooks.js";
import { formatRetrievedSnippets } from "../context/messages.js";
import { queryWorkspaceSnippets } from "../memory/rag.js";
import { buildPromptParts } from "./prompt-builder.js";
import { renderWorkspaceInstructions } from "./instructions.js";
import { mcpPolicyNote, orchestrationNote, skillPolicyNote } from "./policy-sections.js";
import {
  MEMORY_BLOCK_HEADER,
  episodicMemoryLine,
  reflectionBlock,
  semanticMemoryLine,
  sessionNoticeLine,
  toolRosterLine,
} from "./runtime-copy.js";
import type { AgentExecutionContext } from "../execution-context.js";

/** Max `@file` mentions resolved per prompt assembly. */
export const MENTION_RESOLVE_LIMIT = 10;

/** Max memory lines mounted into the system prompt (bounds context cost). */
export const MEMORY_BLOCK_LIMITS: MemoryBlockLimits = { episodic: 3, semantic: 5 };

/** Truncates one memory line so a single verbose lesson cannot flood the prompt. */
function truncateMemoryLine(line: string, maxChars = 300): string {
  const trimmed = line.trim().replace(/\s+/g, " ");
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 1)}…` : trimmed;
}

/**
 * Renders recalled cross-session memories as a prompt block.
 * Returns "" when there is nothing to mount (fail-closed to stateless).
 * `limits` caps mounted lines per layer (custom dimensions may raise them).
 */
export function renderMemoryBlock(
  memory: MemoryRecallResult | undefined | null,
  limits: MemoryBlockLimits = MEMORY_BLOCK_LIMITS,
): string {
  if (memory === undefined || memory === null) return "";
  const lines: string[] = [];
  for (const entry of (memory.episodic ?? []).slice(0, limits.episodic)) {
    const outcome = entry.success ? "succeeded" : "failed";
    const via = entry.keyActions.length > 0 ? ` (via ${entry.keyActions.slice(0, 6).join(", ")})` : "";
    const lesson = entry.lessons.trim() !== "" ? `: ${entry.lessons}` : "";
    lines.push(episodicMemoryLine(entry.task, outcome, via, lesson));
  }
  for (const fact of (memory.semantic ?? []).slice(0, limits.semantic)) {
    lines.push(semanticMemoryLine(fact.subject, fact.predicate, fact.object));
  }
  if (lines.length === 0) return "";
  return `${MEMORY_BLOCK_HEADER}${lines.map((line) => truncateMemoryLine(line)).join("\n")}`;
}

/**
 * Renders the prior-turn history as neutral messages (no system, no user).
 * The single source of the history rules: tool entries pass through verbatim
 * (full mode expands tool rounds into structured turns), and empty-text turns
 * are skipped unless they carry tool calls (the shell). Callers that seed a
 * transcript built elsewhere (the framework bridges) mount exactly these turns.
 */
export function buildHistoryMessages(history?: ChatTurnMessage[]): LlmMessage[] {
  const messages: LlmMessage[] = [];
  for (const message of history ?? []) {
    if (message.role === "tool") {
      messages.push({ role: "tool", content: message.content, toolCallId: message.toolCallId, name: message.name });
      continue;
    }
    const text = (message.content ?? "").trim();
    const calls = message.role === "assistant" ? (message.toolCalls ?? []) : [];
    if (text === "" && calls.length === 0) continue;
    messages.push(
      message.role === "assistant"
        ? { role: "assistant", content: text, ...(calls.length > 0 ? { toolCalls: calls } : {}) }
        : { role: "user", content: text },
    );
  }
  return messages;
}

/**
 * Builds the initial LlmMessage list: system + rendered history + this turn's user.
 * History arrives already rendered per the column's history mode (full mode expands
 * tool rounds into structured assistant/tool turns), so tool entries pass through
 * verbatim; empty-text turns are skipped unless they carry tool calls (the shell).
 */
export function buildInitialMessages(system: string, user: string, history?: ChatTurnMessage[]): LlmMessage[] {
  return [{ role: "system", content: system }, ...buildHistoryMessages(history), { role: "user", content: user }];
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
  // The run's active dimensions; `config.custom` (read below as the hook context)
  // is the value record they were resolved from.
  const activeCustomDimensions = context.customDimensions ?? [];
  // Custom-dimension prompt tags ride with the policy notes, so the column's
  // prompt states which custom values are in force (same convention as the
  // builtin context hints). The `prompt` hook below may reshape them.
  if (activeCustomDimensions.length > 0) {
    system += customPromptHint(activeCustomDimensions);
  }
  if (memoryPolicy !== "none") {
    // The memory hook adjusts the recall and the per-layer render caps together:
    // "inject everything" needs the caps, "inject the top N" needs the recall.
    const memory = applyCustomMemory(activeCustomDimensions, context.memoryRecall, MEMORY_BLOCK_LIMITS, {
      question,
      custom: config.custom,
    });
    system += renderMemoryBlock(memory.recall, memory.limits);
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
  // Replaces everything composed so far (policy notes, memory block, skill
  // preload, workspace instructions); the roster, reflection feedback, and
  // notices below still append so a custom prompt keeps the runtime facts.
  const override = (context.systemPromptOverride ?? "").trim();
  if (override !== "") {
    system = override;
  }
  // Reply-language pin survives the override: an all-English system prompt pulls
  // even Chinese questions toward English replies, and a custom prompt must not
  // lose the UI-language contract either.
  const replyDirective = agentReplyDirective(context.language);
  if (replyDirective !== "") {
    system += replyDirective;
  }
  // The authoritative tool roster: rendered from the actually-registered set
  // (builder allowlist, toolset selection, plus MCP joins), so the prompt never
  // promises a tool the runtime would refuse. Appended after the override so a
  // custom system prompt still learns the real roster.
  const toolNames = [...context.tools.names];
  if (toolNames.length > 0) {
    system += toolRosterLine(toolNames);
  }
  const feedback = (context.verificationFeedback ?? "").trim();
  if (feedback !== "") {
    system += reflectionBlock(feedback);
  }
  const notices = (context.notices ?? []).map((notice) => notice.trim()).filter((notice) => notice !== "");
  if (notices.length > 0) {
    system += `\n\n${notices.map((notice) => sessionNoticeLine(notice)).join("\n\n")}`;
  }
  // Custom-dimension prompt hooks run last, on the fully composed halves: a
  // dimension is trusted operator code (same trust level as a driver) and may
  // therefore append, rewrite, or strip anything above — including the roster.
  if (activeCustomDimensions.length > 0) {
    return applyCustomPrompt(activeCustomDimensions, { system, user }, { question, custom: config.custom });
  }
  return { system, user };
}
