/**
 * @file ViewModeSwitcher
 * @description Results-stage view selector in the stage toolbar.
 *
 * Responsibilities:
 * - Render the view-mode dropdown plus the active view's page-size control
 * - Translate mode ids into catalog labels; keep ids as stable values
 */

"use client";

import { LayoutGrid, Columns2, Trophy, Gauge, ScrollText, Activity } from "lucide-react";
import { UiSelect } from "@agentprism/ui";
import { useT } from "@/i18n/useT";
import { PAGE_SIZE_OPTIONS, VIEW_MODES, type PageSize, type ViewMode, type ViewPrefs } from "./useViewMode";

/** Mode id → toolbar icon. */
const MODE_ICONS: Record<ViewMode, React.ReactNode> = {
  all: <LayoutGrid className="h-3.5 w-3.5" />,
  paged: <Columns2 className="h-3.5 w-3.5" />,
  podium: <Trophy className="h-3.5 w-3.5" />,
  stats: <Gauge className="h-3.5 w-3.5" />,
  gallery: <ScrollText className="h-3.5 w-3.5" />,
  timeline: <Activity className="h-3.5 w-3.5" />,
};

/** Modes whose toolbar shows a per-page selector (keyed by mode id). */
const PAGE_SIZE_MODES = new Set<ViewMode>(["all", "paged"]);

/** View selector: the mode dropdown plus a per-page selector for paged modes. */
export function ViewModeSwitcher({ prefs, onModeChange, onAllPageSizeChange, onPagedPageSizeChange }: {
  prefs: ViewPrefs;
  onModeChange: (mode: ViewMode) => void;
  onAllPageSizeChange: (size: PageSize) => void;
  onPagedPageSizeChange: (size: PageSize) => void;
}) {
  const t = useT();
  const showPageSize = PAGE_SIZE_MODES.has(prefs.mode);
  const pageSize = prefs.mode === "paged" ? prefs.pagedPageSize : prefs.allPageSize;
  const onPageSizeChange = prefs.mode === "paged" ? onPagedPageSizeChange : onAllPageSizeChange;
  return (
    <div className="arena-view-switcher">
      {showPageSize && (
        <UiSelect
          value={`${pageSize}`}
          onChange={(v) => onPageSizeChange(Number(v) as PageSize)}
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
