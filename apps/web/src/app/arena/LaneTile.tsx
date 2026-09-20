/**
 * @file LaneTile
 * @description Dimension-option selection tile (participating-column toggle).
 *
 * Responsibilities:
 * - Toggle a comparison lane on/off
 * - Resolve visible strings via the dimensions catalog
 */

"use client";

import type { DimensionOption } from "@agentprism/client";
import { useT } from "@/i18n/useT";
import { dimOptionLabel } from "./dimensionLabels";

/**
 * Dimension-option selection tile (the participating-column toggle in the setup area).
 * Selected state is carried by the lane tint/border alone — no check ornament.
 */
export function LaneTile({
  option,
  selected,
  onToggle,
  lane,
  disabled = false,
  dimensionId,
  labelOverride,
}: {
  option: DimensionOption;
  selected: boolean;
  onToggle: (value: string) => void;
  lane: number;
  disabled?: boolean;
  dimensionId: string;
  /** Skips the catalog lookup (custom values have no catalog entry, and the caller already localized the label). */
  labelOverride?: string;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => onToggle(option.value)}
      disabled={disabled}
      data-selected={selected}
      data-lane={lane % 4}
      className="lane-tile disabled:cursor-not-allowed disabled:opacity-60"
      aria-pressed={selected}
      title={disabled ? t("arena.setup.laneLockedTitle") : undefined}
    >
      <span className="truncate">{labelOverride ?? dimOptionLabel(t, dimensionId, option.value, option.label)}</span>
    </button>
  );
}
