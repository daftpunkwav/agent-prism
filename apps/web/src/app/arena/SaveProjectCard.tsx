/**
 * @file SaveProjectCard
 * @description Archive-as-project card in the report tab.
 *
 * Responsibilities:
 * - Collect the project name and trigger the save action
 */

"use client";

import { FolderPlus, Loader2 } from "lucide-react";
import { useT } from "@/i18n/useT";

export interface SaveProjectCardProps {
  projectName: string;
  onProjectNameChange: (value: string) => void;
  savingProject: boolean;
  saveProjectMsg: string | null;
  /** Success flag for saveProjectMsg (locale-independent coloring); null when no save happened yet. */
  saveProjectOk: boolean | null;
  canSave: boolean;
  onSave: () => void;
}

/** Save as a project: writes this experiment's workspace files and comparison results into the project list. */
export function SaveProjectCard({
  projectName,
  onProjectNameChange,
  savingProject,
  saveProjectMsg,
  saveProjectOk,
  canSave,
  onSave,
}: SaveProjectCardProps) {
  const t = useT();
  return (
    <section className="panel-surface !shadow-none p-4 space-y-3">
      <div className="flex items-center gap-2">
        <FolderPlus className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{t("arena.project.title")}</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t("arena.project.desc")}
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          className="form-input flex-1"
          placeholder={t("arena.project.namePlaceholder")}
          value={projectName}
          onChange={(e) => onProjectNameChange(e.target.value)}
          disabled={savingProject}
          maxLength={100}
          aria-label={t("arena.project.nameAria")}
        />
        <button type="button" className="btn-primary shrink-0" disabled={savingProject || !canSave} onClick={onSave}>
          {savingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
          {savingProject ? t("arena.action.saving") : t("arena.project.create")}
        </button>
      </div>
      {saveProjectMsg && (
        <p className={"text-xs " + (saveProjectOk ? "text-success" : "text-destructive")}>
          {saveProjectMsg}
        </p>
      )}
    </section>
  );
}
