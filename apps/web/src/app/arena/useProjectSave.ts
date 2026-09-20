/**
 * @file useProjectSave
 * @description Project save strategy for the Arena page's archiving flow.
 *
 * Responsibilities:
 * - Fall back the name, collect workspaces, and issue the save call
 *
 * Rendering belongs to SaveProjectCard; this hook only holds state and actions.
 */

"use client";

import { useCallback, useState } from "react";
import type { ColumnState } from "@agentprism/arena-view";
import { createProject } from "@agentprism/client";
import { useLocale, useT } from "@/i18n/useT";
import { formatDateTime } from "@/i18n/format";

/** Archives settled runs as projects with name validation and save state. */
export function useProjectSave(options: {
  allCompleted: boolean;
  columnList: ColumnState[];
  dimension: string;
  /** The question of the most recent successful run; falls back to the current input when empty. */
  lastRunQuestion: string;
  question: string;
}) {
  const { allCompleted, columnList, dimension, lastRunQuestion, question } = options;
  const t = useT();
  const locale = useLocale();
  const [projectName, setProjectName] = useState("");
  const [savingProject, setSavingProject] = useState(false);
  const [saveProjectMsg, setSaveProjectMsg] = useState<string | null>(null);
  /** Success flag paired with saveProjectMsg; keeps the card's coloring locale-independent. */
  const [saveProjectOk, setSaveProjectOk] = useState<boolean | null>(null);

  const save = useCallback(async () => {
    if (!allCompleted || savingProject) return;
    const workspaceNames = columnList.map((c) => c.workspace).filter((w): w is string => Boolean(w));
    if (workspaceNames.length === 0) {
      setSaveProjectMsg(t("arena.project.noWorkspace"));
      setSaveProjectOk(false);
      return;
    }
    const name =
      projectName.trim() ||
      t("arena.project.autoName", { dimension, time: formatDateTime(locale, new Date().toISOString()) });
    setSavingProject(true);
    setSaveProjectMsg(null);
    setSaveProjectOk(null);
    try {
      const { project } = await createProject({
        name,
        question: lastRunQuestion.trim() || question.trim(),
        dimension,
        pipeline_labels: columnList.map((c) => c.label),
        workspace_names: workspaceNames,
      });
      setSaveProjectMsg(t("arena.project.saved", { name: project.name }));
      setSaveProjectOk(true);
      setProjectName("");
    } catch (err) {
      setSaveProjectMsg(err instanceof Error ? err.message : t("arena.project.saveFailed"));
      setSaveProjectOk(false);
    } finally {
      setSavingProject(false);
    }
  }, [allCompleted, savingProject, columnList, projectName, dimension, question, lastRunQuestion, t, locale]);

  const canSave = allCompleted && Boolean(lastRunQuestion.trim());

  return { projectName, setProjectName, savingProject, saveProjectMsg, saveProjectOk, canSave, save };
}
