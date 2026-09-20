/**
 * @file ArenaSetupModule
 * @description Compact experiment setup: participants strip plus persistent stage tools.
 *
 * Responsibilities:
 * - Render participating-column selection as an always-visible one-row strip
 * - Show the active comparison dimension as a read-only hint (no dimension control)
 * - Open the baseline modal, params drawer, and workspace drawer via pressed-state chips
 *
 * The baseline form itself lives in BaselineModal, so toggling settings never
 * changes this strip's geometry.
 */

"use client";

import { useState } from "react";
import { ChevronDown, GitCompare, PanelLeft, PanelRight, SlidersHorizontal } from "lucide-react";
import type { ArenaMeta, DimensionId } from "@agentprism/client";
import { UiSelect } from "@agentprism/ui";
import { LaneTile } from "./LaneTile";
import { useT } from "@/i18n/useT";
import { dimFieldLabel } from "./dimensionLabels";

/** Comparison dimensions whose lanes accept custom in-range values beyond the presets. */
const CUSTOM_LANE_DIMENSIONS = new Set<string>(["max_steps", "temperature"]);

/** Looks up the server-served numeric range for a dimension's config field (meta is the single source). */
function customLaneRange(meta: ArenaMeta | null, dimension: string): { min: number; max: number } | null {
  const field = dimension === "max_steps" ? "max_steps" : "temperature";
  const entry = meta?.baseline_fields.find((f) => f.field === field);
  if (entry && typeof entry.min === "number" && typeof entry.max === "number") {
    return { min: entry.min, max: entry.max };
  }
  return null;
}

/**
 * Inline adder for custom lane values on numeric dimensions. Commits only
 * in-range tokens ("unlimited" for max_steps) so the backend's custom-value
 * validation never rejects a lane the UI already accepted.
 */
function CustomLaneAdder({
  dimension,
  range,
  selected,
  disabled,
  onAdd,
}: {
  dimension: string;
  range: { min: number; max: number };
  selected: readonly string[];
  disabled: boolean;
  onAdd: (value: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    const raw = text.trim();
    if (raw === "") return;
    let token: string | null = null;
    if (dimension === "max_steps" && raw.toLowerCase() === "unlimited") {
      token = "unlimited";
    } else {
      const parsed = Number(raw);
      const inRange = Number.isFinite(parsed) && parsed >= range.min && parsed <= range.max;
      const integral = dimension !== "max_steps" || Number.isInteger(parsed);
      if (inRange && integral) token = String(parsed);
    }
    if (token === null || selected.includes(token)) {
      setInvalid(token === null);
      setText("");
      return;
    }
    setInvalid(false);
    setText("");
    onAdd(token);
  };

  return (
    <span className="lane-custom">
      <input
        type="text"
        inputMode={dimension === "max_steps" ? "numeric" : "decimal"}
        autoComplete="off"
        spellCheck={false}
        className="lane-custom-input"
        disabled={disabled}
        value={text}
        aria-label={t("arena.setup.laneCustomAria")}
        aria-invalid={invalid}
        placeholder={t("arena.setup.laneCustomPlaceholder")}
        title={t("arena.setup.laneCustomTitle", { min: String(range.min), max: String(range.max) })}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            setText("");
            setInvalid(false);
            (event.target as HTMLInputElement).blur();
          }
        }}
        onBlur={() => {
          if (text.trim() !== "") commit();
        }}
      />
    </span>
  );
}

/** Localized display label for a custom lane token (no catalog entry exists for arbitrary values). */
function customLaneLabel(t: ReturnType<typeof useT>, dimension: string, value: string): string {
  if (dimension === "max_steps") {
    return value === "unlimited"
      ? t("arena.setup.baselineUnlimited")
      : t("arena.setup.laneCustomSteps", { value });
  }
  return value;
}

export interface ArenaSetupModuleProps {
  baselineOpen: boolean;
  onOpenBaseline: () => void;
  running: boolean;
  meta: ArenaMeta | null;
  dimension: DimensionId;
  /** Switches the comparison dimension upstream (resets run state, syncs the URL). */
  onDimensionChange: (id: DimensionId) => void;
  activeDim: ArenaMeta["dimensions"][number] | null;
  activeSelections: string[];
  onToggleSelection: (value: string) => void;
  showLeftPanel: boolean;
  /** Toggles the left drawer and closes the right one (the original exclusive behavior). */
  onToggleLeftPanel: () => void;
  showRightPanel: boolean;
  /** Toggles the right drawer and closes the left one (the original exclusive behavior). */
  onToggleRightPanel: () => void;
}

/** Compact experiment setup: participant tiles stay visible in one strip; every stage control is a persistent chip. */
export function ArenaSetupModule({
  baselineOpen,
  onOpenBaseline,
  running,
  meta,
  dimension,
  onDimensionChange,
  activeDim,
  activeSelections,
  onToggleSelection,
  showLeftPanel,
  onToggleLeftPanel,
  showRightPanel,
  onToggleRightPanel,
}: ArenaSetupModuleProps) {
  const t = useT();
  const customLanes = CUSTOM_LANE_DIMENSIONS.has(dimension);
  const laneRange = customLanes ? customLaneRange(meta, dimension) : null;
  const presetValues = new Set((activeDim?.options ?? []).map((opt) => opt.value));
  const optionField = activeDim?.options[0]?.field ?? dimension;
  const extraOptions = (activeSelections ?? [])
    .filter((value) => !presetValues.has(value))
    .map((value) => ({ field: optionField, value, label: customLaneLabel(t, dimension, value) }));
  return (
    <div className="arena-chrome">
      <div className="arena-module">
        <div className="arena-module-head">
          <div className="arena-participants">
            {activeDim && (
              <div className="lane-pick">
                {activeDim.options.map((opt, idx) => (
                  <LaneTile
                    key={opt.value}
                    option={opt}
                    selected={activeSelections.includes(opt.value)}
                    onToggle={onToggleSelection}
                    lane={idx}
                    disabled={running}
                    dimensionId={activeDim.id}
                  />
                ))}
                {extraOptions.map((opt, idx) => (
                  <LaneTile
                    key={opt.value}
                    option={opt}
                    selected
                    onToggle={onToggleSelection}
                    lane={activeDim.options.length + idx}
                    disabled={running}
                    dimensionId={activeDim.id}
                    labelOverride={opt.label}
                  />
                ))}
                {customLanes && laneRange !== null && (
                  <CustomLaneAdder
                    dimension={dimension}
                    range={laneRange}
                    selected={activeSelections}
                    disabled={running}
                    onAdd={onToggleSelection}
                  />
                )}
              </div>
            )}
          </div>
          <div className="arena-setup-tools">
            <UiSelect
              className="dim-select"
              disabled={running}
              value={dimension}
              onChange={(id) => onDimensionChange(id as DimensionId)}
              ariaLabel={t("arena.setup.dimensionLabel")}
              triggerLabel={t("arena.setup.dimensionLabel")}
              icon={<GitCompare className="h-3 w-3" aria-hidden />}
              options={(meta?.dimensions ?? []).map((d) => ({
                value: d.id,
                label: dimFieldLabel(t, d.id, d.label),
              }))}
            />
            <button
              type="button"
              className="chip-toggle"
              onClick={onOpenBaseline}
              aria-expanded={baselineOpen}
              title={t("arena.setup.baselineToggleTitle")}
            >
              <SlidersHorizontal className="h-3 w-3" aria-hidden />
              {t("arena.setup.baselineShort")}
              <ChevronDown className="chip-toggle-chevron h-3 w-3" aria-hidden />
            </button>
            <button
              type="button"
              className="chip-toggle"
              onClick={onToggleLeftPanel}
              aria-pressed={showLeftPanel}
              aria-label={showLeftPanel ? t("arena.drawer.closeParamsAria") : t("arena.drawer.openParamsAria")}
              title={showLeftPanel ? t("arena.drawer.closeParamsAria") : t("arena.label.params")}
            >
              <PanelLeft className="h-3 w-3" aria-hidden />
              {t("arena.label.params")}
            </button>
            <button
              type="button"
              className="chip-toggle"
              onClick={onToggleRightPanel}
              aria-pressed={showRightPanel}
              aria-label={showRightPanel ? t("arena.drawer.closeWorkspaceAria") : t("arena.drawer.openWorkspaceAria")}
              title={showRightPanel ? t("arena.drawer.closeWorkspaceAria") : t("arena.label.workspace")}
            >
              <PanelRight className="h-3 w-3" aria-hidden />
              {t("arena.label.workspace")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
