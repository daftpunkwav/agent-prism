/**
 * @file WorkspaceExplorer
 * @description Full-stage workspace takeover with per-agent attribution.
 *
 * Responsibilities:
 * - Fill the whole arena stage while open (the old side drawer is gone)
 * - Pick which agent's workspace to browse (attribution select in the header)
 * - Host the shared two-pane WorkspacePanel at full size
 *
 * Escape closes; the stage behind stays mounted so a close never loses run state.
 */

"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { UiSelect } from "@agentprism/ui";
import { WorkspacePanel } from "./WorkspacePanel";
import { useT } from "@/i18n/useT";

export interface WorkspaceExplorerProps {
  /** Agent-attribution choices: column label → workspace name. */
  choices: Array<{ label: string; workspace: string }>;
  /** Currently focused column label. */
  focusLabel: string | null;
  onFocusChange: (label: string) => void;
  /** Locale overlay for the attribution select entries. */
  resolveLabel: (label: string) => string;
  running: boolean;
  refreshToken: number;
  onClose: () => void;
}

/** Full-stage workspace explorer: attribution header + two-pane file browser. */
export function WorkspaceExplorer({
  choices,
  focusLabel,
  onFocusChange,
  resolveLabel,
  running,
  refreshToken,
  onClose,
}: WorkspaceExplorerProps) {
  const t = useT();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const focused = choices.find((choice) => choice.label === focusLabel) ?? choices[0];

  return (
    <div className="workspace-explorer" role="dialog" aria-label={t("arena.label.workspace")}>
      <div className="workspace-explorer-head">
        <span className="eyebrow shrink-0">{t("arena.label.workspace")}</span>
        {choices.length > 1 ? (
          <UiSelect
            className="!h-7 min-w-0 flex-1 text-[11px]"
            value={focused?.label ?? ""}
            onChange={onFocusChange}
            ariaLabel={t("arena.drawer.pickWorkspaceAria")}
            options={choices.map((choice) => ({
              value: choice.label,
              label: resolveLabel(choice.label),
            }))}
          />
        ) : (
          focused && <span className="font-mono text-[11px] text-muted-foreground truncate">{resolveLabel(focused.label)}</span>
        )}
        <button
          type="button"
          className="btn-ghost !h-7 !w-7 !p-0 shrink-0"
          onClick={onClose}
          aria-label={t("arena.drawer.closeWorkspaceAria")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="workspace-explorer-body">
        {focused ? (
          <WorkspacePanel
            workspaceName={focused.workspace}
            pollInterval={running ? 1500 : 5000}
            refreshToken={refreshToken}
            ownerLabel={resolveLabel(focused.label)}
          />
        ) : (
          <p className="px-3 py-4 text-xs text-muted-foreground">{t("arena.drawer.emptyWorkspace")}</p>
        )}
      </div>
    </div>
  );
}
