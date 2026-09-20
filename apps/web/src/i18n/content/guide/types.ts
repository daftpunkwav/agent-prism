/**
 * @file content/guide/types
 * @description Structural types of the guide content module.
 *
 * Responsibilities:
 * - Type sections, blocks, and per-dimension docs
 *
 * Dimension ids are typed from the contract single source DimensionId.
 */

import type { DimensionId } from "@agentprism/client";

export type Reality = "full" | "partial" | "prompt-only";

type DimOption = {
  value: string;
  label: string;
  effect: string;
};

export type DimDoc = {
  id: DimensionId;
  label: string;
  reality: Reality;
  summary: string;
  controls: string;
  options: DimOption[];
  path: string[];
  langChain: string;
  langGraph: string;
  modules: string[];
  baselineTip: string;
  caveats: string[];
};

/** Block model of the overview/boundaries sections: the view renders exhaustively by kind; a new kind must update the view in sync (compile-time interception). */
type GuideFormulaCard = { tag: string; text: string; code: string };

export type GuideBlock =
  | { kind: "formula"; cards: GuideFormulaCard[]; operators: string[] }
  | { kind: "note"; text: string }
  | { kind: "steps"; heading: string; items: string[] }
  | { kind: "bullets"; heading: string; items: string[] }
  | { kind: "codeList"; heading: string; items: string[] }
  | { kind: "cards"; items: Array<{ title: string; body: string }> }
  | { kind: "stages"; items: Array<{ title: string; detail: string; module: string }> }
  | { kind: "fieldMatrix" }
  | { kind: "toolsetGrid" };

type GuideSectionGroupId = "overview" | "boundary";

export type GuideSection = {
  id: string;
  title: string;
  group: GuideSectionGroupId;
  /** Section lead (supports inline Markdown: `code`, **emphasis**). */
  lead?: string;
  blocks: GuideBlock[];
};

export type GuideHeroAction = {
  href: string;
  label: string;
  icon: "flask" | "arrow";
  variant: "primary" | "ghost";
};

export type GuideHero = {
  eyebrow: string;
  title: string;
  lead: string;
  actions: GuideHeroAction[];
  pillars: Array<{ kicker: string; text: string }>;
  metrics: Array<{ label: string; count: number }>;
  /** Max number of hero dimension chips shown; extras collapse to +N. */
  dimChipLimit: number;
};
