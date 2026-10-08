/**
 * @file ViewModeSwitcher
 * @description Results-stage view selector in the stage toolbar.
 *
 * Responsibilities:
 * - Render the view-mode dropdown plus the default view's page-size control
 * - Translate mode ids into catalog labels; keep ids as stable values
 */

"use client";

import { LayoutGrid, Columns2, Trophy, Gauge, ScrollText, Activity } from "lucide-react";
import { UiSelect } from "@agentprism/ui";
import { useT } from "@/i18n/useT";
import { PAGE_SIZE_OPTIONS, VIEW_MODES, type ViewMode, type ViewPrefs } from "./useViewMode";

/** Mode id → toolbar icon. */
const MODE_ICONS: Record<ViewMode, React.ReactNode> = {
  all: <LayoutGrid className="h-3.5 w-3.5" />,
  paged: <Columns2 className="h-3.5 w-3.5" />,
  podium: <Trophy className="h-3.5 w-3.5" />,
  stats: <Gauge className="h-3.5 w-3.5" />,
  gallery: <ScrollText className="h-3.5 w-3.5" />,
  timeline: <Activity className="h-3.5 w-3.5" />,
};

/** View selector: the mode dropdown plus a per-page cap for the default view. */
export function ViewModeSwitcher({ prefs, onModeChange, onPageSizeChange }: {
  prefs: ViewPrefs;
  onModeChange: (mode: ViewMode) => void;
  onPageSizeChange: (size: ViewPrefs["pageSize"]) => void;
}) {
  const t = useT();
  return (
    <div className="arena-view-switcher">
      {prefs.mode === "all" && (
        <UiSelect
          value={`${prefs.pageSize}`}
          onChange={(v) => onPageSizeChange(Number(v) as ViewPrefs["pageSize"])}
          options={PAGE_SIZE_OPTIONS.map((size) => ({ value: `${size}`, label: t("arena.view.pageSizeOption", { count: size }) }))}
          ariaLabel={t("arena.view.pageSizeAria")}
          className="arena-view-pagesize"
        />
      )}
      <UiSelect
        value={prefs.mode}
        onChange={(v) => onModeChange(v as ViewMode)}
        options={VIEW_MODES.map((mode) => ({ value: mode, label: t(`arena.view.mode.${mode}` as "arena.view.mode.all") }))}
        ariaLabel={t("arena.view.modeAria")}
        className="arena-view-mode"
        icon={MODE_ICONS[prefs.mode]}
      />
    </div>
  );
}
