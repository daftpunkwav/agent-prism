/**
 * @file content/learn/types
 * @description Structural types of the learn content module.
 *
 * Responsibilities:
 * - Type the hero and week-plan shapes
 *
 * Dimension ids are typed from the contract single source DimensionId.
 */

import type { DimensionId } from "@agentprism/client";

export type WeekStep = {
  week: number;
  title: string;
  goal: string;
  items: string[];
  /** Arena comparison dimension id; a typo in /arena's URL params is silently ignored — the type constraint catches it at compile time */
  dimension: DimensionId;
  /** Arena task-template id; single source packages/arena/arena-dimensions/src/task-templates.ts */
  template: string;
};
