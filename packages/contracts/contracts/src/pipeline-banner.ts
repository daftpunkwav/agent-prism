/**
 * @file pipeline-banner
 * @description Contract for driver Step-0 config banners (single source).
 *
 * Responsibilities:
 * - Define banner prefixes indexed by frameworkId, never displayName
 * - Detect foreign banners
 *
 * Indexing by id keeps new drivers from silently breaking foreign-banner
 * detection.
 */

/** Banner prefix per driver (indexed by framework id). */
export const PIPELINE_BANNER_PREFIX = {
  autogen: "[AutoGen group-chat]",
  claude_agent_sdk: "[Claude Agent SDK]",
  crewai: "[CrewAI crew]",
  deepagents: "[Deep Agents]",
  langchain: "[LangChain create_agent]",
  langgraph: "[LangGraph]",
  native: "[Native Agent]",
  openai_agents: "[OpenAI Agents SDK]",
  plan_execute: "[Plan-Execute]",
  self_critique: "[Self-Critique]",
} as const;

export type PipelineBannerFrameworkId = keyof typeof PIPELINE_BANNER_PREFIX;

/** All banner prefixes (for recognition). */
export const PIPELINE_BANNER_PREFIXES: readonly string[] = Object.values(PIPELINE_BANNER_PREFIX);

/** Framework ids that have a registered banner prefix. */
export const PIPELINE_BANNER_FRAMEWORK_IDS: readonly string[] = Object.keys(PIPELINE_BANNER_PREFIX);

function startsWithAnyBanner(text: string): boolean {
  return PIPELINE_BANNER_PREFIXES.some((prefix) => text.startsWith(prefix));
}

/** Whether the content is a driver config banner. */
export function isPipelineConfigBanner(content: string | undefined | null): boolean {
  if (!content) return false;
  return startsWithAnyBanner(content.trimStart());
}

/** Resolves the banner prefix for a framework id; undefined when unknown. */
export function bannerPrefixForFramework(frameworkId: string | undefined | null): string | undefined {
  if (!frameworkId) return undefined;
  return (PIPELINE_BANNER_PREFIX as Record<string, string>)[frameworkId];
}

/**
 * Whether a config banner belongs to a different framework than this column.
 * Unknown frameworkId fails open (returns false): without a known own-prefix,
 * foreignness cannot be decided, so the banner is kept and rendered as metadata.
 */
export function isForeignPipelineConfigBanner(
  content: string | undefined | null,
  frameworkId: string | undefined,
): boolean {
  if (!content || !frameworkId || !isPipelineConfigBanner(content)) return false;
  const own = bannerPrefixForFramework(frameworkId);
  if (own === undefined) return false;
  return !content.trimStart().startsWith(own);
}
