/**
 * @file ArenaClient
 * @description Arena page container: layout, run orchestration guards, hook wiring.
 *
 * Responsibilities:
 * - Own stage layout (tabs/drawers) and run guard state
 * - Wire config, stream, session, and panel hooks together
 *
 * Follow-up history commits and project saving each live in their own hooks.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, FileJson, GitCompare, Terminal, X } from "lucide-react";
import { UiSelect } from "@agentprism/ui";
import type { RunAttachment } from "@agentprism/client";
import type { DimensionId } from "@agentprism/client";
import { ComparisonReport } from "./ComparisonReport";
import { MatrixPanel } from "./MatrixPanel";
import { DecodeDefaultsPanel } from "./DecodeDefaultsPanel";
import { TraceDiff } from "./TraceDiff";
import { LogsDiff } from "./LogsDiff";
import { WorkspacePanel } from "./WorkspacePanel";
import { BaselineModal } from "./BaselineModal";
import type { PendingAskBatch } from "@/components/AskUserModal";
import { useArenaStream } from "./useArenaStream";
import { deriveTurn } from "./useColumnSessions";
import { useColumnSessions } from "./useColumnSessions";
import { useArenaConfig } from "./useArenaConfig";
import { useArenaAutoJudge } from "./useArenaAutoJudge";
import { useHistoryCommit } from "./useHistoryCommit";
import { useProjectSave } from "./useProjectSave";
import { ArenaResultsGrid } from "./ArenaResultsGrid";
import { MainTabButton } from "./MainTabButton";
import { ArenaSetupModule } from "./ArenaSetupModule";
import { ComposerBar } from "./ComposerBar";
import { SaveProjectCard } from "./SaveProjectCard";
import { useLocale, useT } from "@/i18n/useT";
import type { MainTab } from "./arenaConstants";
import type { TaskTemplate } from "@agentprism/client";
import { pipelineDisplayLabel, dimSubtitle } from "./dimensionLabels";
import { templateQuestion } from "./templateLabels";

/** Attachment limits: mirrored by the server-side RunAttachmentSchema (defense in depth). */
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 64 * 1024;
const MAX_ATTACHMENT_CHARS = 64 * 1024;

/** Arena container: layout (tabs/drawers), run orchestration guards, and hook wiring only; follow-up commits and project saving are hooks of their own. */
export function ArenaClient() {
  const t = useT();
  const locale = useLocale();
  const [showPromptBanner, setShowPromptBanner] = useState(true);
  const [showLeftPanel, setShowLeftPanel] = useState(false);
  /** Workspace starts collapsed, expand when needed */
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [workspaceFocusLabel, setWorkspaceFocusLabel] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("results");
  /** Baseline settings live in a modal so the setup strip never changes size */
  const [baselineOpen, setBaselineOpen] = useState(false);
  /** Text files seeded into the columns' fresh workspaces for the next run */
  const [attachments, setAttachments] = useState<RunAttachment[]>([]);
  /** The question of the most recent successful run (still usable for saving a project after history-commit clears the input) */
  const [lastRunQuestion, setLastRunQuestion] = useState("");
  const {
    sessions,
    pushColumnTurn,
    rememberWorkspace,
    copyTranscriptToAll,
    reset: resetHistory,
    snapshotFor,
  } = useColumnSessions();
  // SSE streaming consumption and column state (events in → columns update → running/abort/error)
  const {
    columns,
    comparisonReport,
    workspaceRefreshToken,
    running,
    error,
    setError,
    run: streamRun,
    cancelRun,
    stopColumn,
    stoppingLabels,
    resetColumns,
    applyJudgeResults,
    stop: stopStream,
    pendingAsks,
    askSubmitting,
    answerAsk,
    clearPendingAsk,
  } = useArenaStream();

  // Each asking column renders its own ask window inside its card (batches are
  // keyed by agentId; the column grid looks them up by pipeline label).
  const pendingAsksByLabel = useMemo(() => {
    const byLabel: Record<string, PendingAskBatch> = {};
    for (const batch of Object.values(pendingAsks)) {
      byLabel[batch.sourceLabel] = batch;
    }
    return byLabel;
  }, [pendingAsks]);

  const {
    meta,
    question,
    setQuestion,
    dimension,
    setDimension,
    baseline,
    setBaseline,
    metaLoading,
    templates,
    activeTemplateId,
    setActiveTemplateId,
    applyTemplate,
    baselinePayload,
    activeDim,
    activeSelections,
    columnCount,
    placeholderLabels,
    toggleSelection,
    resetDimensionState,
  } = useArenaConfig(setError);

  const columnList = useMemo(() => Object.values(columns), [columns]);

  const workspaceChoices = useMemo(
    () =>
      columnList.flatMap((col) =>
        col.workspace ? [{ label: col.label, workspace: col.workspace }] : [],
      ),
    [columnList],
  );

  useEffect(() => {
    if (workspaceFocusLabel && workspaceChoices.some((c) => c.label === workspaceFocusLabel)) return;
    setWorkspaceFocusLabel(workspaceChoices[0]?.label ?? null);
  }, [workspaceChoices, workspaceFocusLabel]);

  const focusedWorkspace =
    workspaceChoices.find((c) => c.label === workspaceFocusLabel)?.workspace ??
    workspaceChoices[0]?.workspace ??
    null;

  const resolvePipelineLabel = useCallback(
    (label: string) =>
      activeDim ? pipelineDisplayLabel(t, activeDim.id, label, activeDim.options) : label,
    [activeDim, t],
  );

  const hasMetrics = columnList.some((c) => c.metrics);
  const allSettled = columnList.length >= 1 && columnList.every((c) => c.metrics || c.error);
  // "Completed" = has metrics and success: backend failed columns also carry all-zero metrics (success:false); checking existence alone would count failed turns as complete
  const allCompleted =
    columnList.length >= 1 && columnList.every((c) => c.metrics && c.metrics.success);

  // Auto-judge orchestration; resetJudge's reference is stable (useCallback([])), so runArena can call it in a closure
  const { resetJudge } = useArenaAutoJudge({
    allCompleted,
    activeTemplateId,
    templates,
    question: lastRunQuestion,
    columnList,
    applyJudgeResults,
    setError,
  });

  // Multi-turn follow-ups: history-commit strategy after this turn settles (onCommitted must be a stable reference — it feeds the commit effect's deps)
  const handleTurnCommitted = useCallback(() => setQuestion(""), [setQuestion]);
  const { historySeedLabel, setHistorySeedLabel, beginTurn, cancelTurn } = useHistoryCommit({
    running,
    allSettled,
    columns,
    columnList,
    pushColumnTurn,
    rememberWorkspace,
    onCommitted: handleTurnCommitted,
  });

  useEffect(() => {
    for (const col of columnList) {
      if (col.workspace) rememberWorkspace(col.label, col.workspace);
    }
  }, [columnList, rememberWorkspace]);

  // Stable callback: ColumnCard is memoized, a fresh arrow here would re-render every column each parent render
  const handleUseAsSeed = useCallback(
    (label: string) => {
      const labels = columnList.map((c) => c.label);
      copyTranscriptToAll(label, labels);
      setHistorySeedLabel(label);
    },
    [columnList, copyTranscriptToAll],
  );

  // Abort in-flight Arena requests on unmount to avoid lingering connections (state updates settle inside the hooks)
  useEffect(() => {
    return () => {
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Event merging and system-level error cleanup are delegated to useArenaStream (run's onSystemError callback)
  const handleStop = useCallback(() => {
    cancelRun();
    // User-initiated stop: this turn is not committed to the shared history
    cancelTurn();
  }, [cancelRun, cancelTurn]);

  /** Independently stops one column; the turn still commits when the remaining columns settle. */
  const handleStopColumn = useCallback(
    (label: string) => {
      void stopColumn(label);
    },
    [stopColumn],
  );

  const runArena = async () => {
    if (!question.trim() || running) return;
    if (activeSelections.length < 1) {
      setError(t("arena.error.minSelections"));
      return;
    }
    setError(null);
    setMainTab("results");
    resetJudge();
    const q = question.trim();
    setLastRunQuestion(q);
    const preserveColumns =
      activeDim?.options
        .filter((o) => activeSelections.includes(o.value))
        .map((o) => ({
          label: o.label,
          // Framework dimension: option value is the frameworkId. Other dimensions pin Native.
          frameworkId: dimension === "framework" ? o.value : "native",
        })) ?? [];
    const labels = preserveColumns.map((c) => c.label);
    const columnSessions = snapshotFor(labels);
    // Per-column turn numbers (same formula the backend annotates events with);
    // sessions can diverge when a column skips a run, so one global number lies.
    const turns = Object.fromEntries(labels.map((label) => [label, deriveTurn(columnSessions[label]?.messages ?? [])]));
    beginTurn(turns, q);

    const result = await streamRun(
      {
        question: q,
        dimension,
        selections: activeSelections,
        baseline: baselinePayload,
        columnSessions,
        preserveColumns,
        attachments,
        language: locale,
      },
      () => {
        // Route/baseline-level error: this turn is not committed to the shared history
        cancelTurn();
      },
    );
    // Cancellation or whole-run failure: this turn is not committed to the shared history
    // (when a column fails, allCompleted is false, so the turn also stays out of history; pending is overwritten by the next run)
    if (result.aborted || result.failed) {
      cancelTurn();
      return;
    }
    // Settled run: attachments are seeded into the workspaces; drop them from the composer
    setAttachments([]);
  };

  const clearConversation = useCallback(() => {
    if (running) return;
    resetHistory();
    resetColumns();
    setHistorySeedLabel(null);
    cancelTurn();
    setQuestion("");
    setLastRunQuestion("");
    resetJudge();
    setAttachments([]);
  }, [running, resetHistory, resetColumns, setHistorySeedLabel, cancelTurn, setQuestion, setLastRunQuestion, resetJudge]);

  /** Mirrors the attachments state so the async reader validates against fresh data. */
  const attachmentsRef = useRef<RunAttachment[]>([]);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  /** Reads picked files as text into attachments; validation failures surface via the run error banner. */
  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      for (const file of files) {
        if (attachmentsRef.current.length >= MAX_ATTACHMENTS) {
          setError(t("arena.attach.tooMany"));
          break;
        }
        if (attachmentsRef.current.some((a) => a.name === file.name)) continue;
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setError(t("arena.attach.tooLarge", { name: file.name }));
          continue;
        }
        try {
          const content = (await file.text()).slice(0, MAX_ATTACHMENT_CHARS);
          if (attachmentsRef.current.some((a) => a.name === file.name) || attachmentsRef.current.length >= MAX_ATTACHMENTS) {
            continue;
          }
          const next = [...attachmentsRef.current, { name: file.name, content }];
          attachmentsRef.current = next;
          setAttachments(next);
        } catch (error) {
          console.warn(`[arena] Attachment read failed: ${file.name}`, error);
        }
      }
    },
    [setError, t],
  );

  const handleRemoveAttachment = useCallback((name: string) => {
    setAttachments((prev) => prev.filter((a) => a.name !== name));
  }, []);

  /**
   * Switches the comparison dimension: column selections/sessions belong to the old
   * dimension's options and must reset; the question and attachments carry over.
   * The URL stays the shareable single source (?dimension=).
   */
  const changeDimension = useCallback(
    (id: DimensionId) => {
      if (id === dimension) return;
      resetDimensionState();
      resetColumns();
      resetHistory();
      setHistorySeedLabel(null);
      cancelTurn();
      setDimension(id);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("dimension", id);
        window.history.replaceState(null, "", url.pathname + url.search);
      }
    },
    [dimension, resetDimensionState, resetColumns, resetHistory, setHistorySeedLabel, cancelTurn, setDimension],
  );

  /** Manual question edits drop a stale template binding so auto-judge never judges the wrong text. */
  const handleQuestionChange = useCallback(
    (text: string) => {
      setQuestion(text);
      const template = activeTemplateId ? templates.find((tpl) => tpl.id === activeTemplateId) : undefined;
      if (template) {
        // Template questions render through the locale overlay: the binding survives
        // while the text matches either the canonical or the displayed translation.
        const canonical = template.question.trim();
        const displayed = templateQuestion(t, template.id, template.question).trim();
        if (text.trim() !== canonical && text.trim() !== displayed) setActiveTemplateId(null);
      }
    },
    [activeTemplateId, templates, setQuestion, t],
  );

  // Template suggests a dimension change: reset old experiment state first, then write the
  // template config in the same batch so the suggested selections and the auto-judge marker
  // survive. (The only remaining dimension-switch entry: the setup UI has no dimension control.)
  const handleApplyTemplate = useCallback(
    (tpl: TaskTemplate) => {
      if (tpl.suggested_dimension && tpl.suggested_dimension !== dimension) {
        changeDimension(tpl.suggested_dimension);
        setMainTab("results");
      }
      applyTemplate(tpl);
    },
    [dimension, changeDimension, applyTemplate],
  );

  // Project-save strategy (SaveProjectCard rendered inside the report tab)
  const { projectName, setProjectName, savingProject, saveProjectMsg, saveProjectOk, canSave, save } = useProjectSave({
    allCompleted,
    columnList,
    dimension,
    lastRunQuestion,
    question,
  });

  if (metaLoading) {
    return (
      <div className="arena-shell items-center justify-center">
        <div className="space-y-4 text-center fade-in">
          <div className="loading-prism mx-auto" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("arena.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="arena-shell">
      <div
        className="arena-setup"
        data-running={running ? "true" : undefined}
      >
        <ArenaSetupModule
          baselineOpen={baselineOpen}
          onOpenBaseline={() => setBaselineOpen(true)}
          running={running}
          meta={meta}
          dimension={dimension}
          onDimensionChange={changeDimension}
          activeDim={activeDim}
          activeSelections={activeSelections}
          onToggleSelection={toggleSelection}
          showLeftPanel={showLeftPanel}
          onToggleLeftPanel={() => {
            setShowLeftPanel((v) => !v);
            setShowRightPanel(false);
          }}
          showRightPanel={showRightPanel}
          onToggleRightPanel={() => {
            setShowRightPanel((v) => !v);
            setShowLeftPanel(false);
          }}
        />

        <BaselineModal
          open={baselineOpen}
          onClose={() => setBaselineOpen(false)}
          running={running}
          meta={meta}
          dimension={dimension}
          baseline={baseline}
          onBaselineFieldChange={(field, value) => setBaseline((prev) => ({ ...prev, [field]: value }))}
          showPromptBanner={showPromptBanner}
          onDismissPromptBanner={() => setShowPromptBanner(false)}
        />

        <ComposerBar
          error={error}
          sessions={sessions}
          historySeedLabel={historySeedLabel}
          resolveLabel={resolvePipelineLabel}
          onClearConversation={clearConversation}
          running={running}
          templates={templates}
          onApplyTemplate={handleApplyTemplate}
          question={question}
          onQuestionChange={handleQuestionChange}
          attachments={attachments}
          onAttachFiles={handleAttachFiles}
          onRemoveAttachment={handleRemoveAttachment}
          activeSelectionCount={activeSelections.length}
          onRequestRun={() => void runArena()}
          onRequireSelection={() => {
            setBaselineOpen(true);
            setError(t("arena.error.needSelections"));
          }}
          onStop={handleStop}
        />
      </div>

      <div className="arena-body">
        <button
          type="button"
          className="arena-backdrop"
          data-open={showLeftPanel || showRightPanel ? "true" : undefined}
          aria-label={t("arena.drawer.closeSideAria")}
          aria-hidden={!(showLeftPanel || showRightPanel)}
          tabIndex={showLeftPanel || showRightPanel ? 0 : -1}
          onClick={() => {
            setShowLeftPanel(false);
            setShowRightPanel(false);
          }}
        />

        <aside
          className="arena-drawer"
          data-side="left"
          data-open={showLeftPanel ? "true" : undefined}
          aria-label={t("arena.label.params")}
          aria-hidden={!showLeftPanel}
          inert={!showLeftPanel ? true : undefined}
        >
          <div className="arena-drawer-head">
            <p className="eyebrow">{t("arena.label.params")}</p>
            <button
              type="button"
              className="btn-ghost !h-7 !w-7 !p-0"
              onClick={() => setShowLeftPanel(false)}
              aria-label={t("arena.drawer.closeParamsAria")}
              tabIndex={showLeftPanel ? 0 : -1}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="arena-drawer-body">
            <DecodeDefaultsPanel
              columnCount={columnCount}
              description={
                activeDim ? dimSubtitle(t, activeDim.id, activeDim.subtitle) : ""
              }
            />
          </div>
        </aside>

        <main className="arena-stage">
          <div className="arena-stage-toolbar">
            <div role="tablist" aria-label={t("arena.stage.tabsAria")} className="arena-stage-tabs">
              <MainTabButton
                active={mainTab === "results"}
                onClick={() => setMainTab("results")}
                icon={<Terminal className="h-3.5 w-3.5" />}
                label={t("arena.tab.results")}
                badge={running ? t("arena.tab.running") : columnList.length > 0 ? columnList.length : null}
              />
              <MainTabButton
                active={mainTab === "report"}
                onClick={() => setMainTab("report")}
                icon={<BarChart3 className="h-3.5 w-3.5" />}
                label={t("arena.tab.report")}
                disabled={!hasMetrics}
                disabledReason={t("arena.tab.reportDisabledReason")}
                badge={hasMetrics ? columnList.filter((c) => c.metrics).length : null}
              />
              <MainTabButton
                active={mainTab === "diff"}
                onClick={() => setMainTab("diff")}
                icon={<GitCompare className="h-3.5 w-3.5" />}
                label={t("arena.tab.diff")}
                disabled={!allCompleted}
                disabledReason={t("arena.tab.diffDisabledReason")}
              />
              <MainTabButton
                active={mainTab === "logs"}
                onClick={() => setMainTab("logs")}
                icon={<FileJson className="h-3.5 w-3.5" />}
                label={t("arena.tab.logs")}
              />
              <MainTabButton
                active={mainTab === "matrix"}
                onClick={() => setMainTab("matrix")}
                icon={<BarChart3 className="h-3.5 w-3.5" />}
                label={t("arena.tab.matrix")}
              />
            </div>
          </div>

          <div className="arena-stage-body">
            {mainTab === "results" ? (
              <div key="results" className="arena-tab-pane fade-in h-full min-h-0">
                <ArenaResultsGrid
                  activeDim={activeDim}
                  activeSelections={activeSelections}
                  columns={columns}
                  columnList={columnList}
                  columnCount={columnCount}
                  placeholderLabels={placeholderLabels}
                  running={running}
                  historySeedLabel={historySeedLabel}
                  onStopColumn={handleStopColumn}
                  stoppingLabels={stoppingLabels}
                  onUseAsSeed={handleUseAsSeed}
                  workspaceRefreshToken={workspaceRefreshToken}
                  pendingAsksByLabel={pendingAsksByLabel}
                  askSubmitting={askSubmitting}
                  onAskAnswer={answerAsk}
                  onAskDismiss={clearPendingAsk}
                />
              </div>
            ) : (
              <div key={mainTab} className="arena-stage-scroll arena-tab-pane fade-in">
                {mainTab === "report" && hasMetrics && (
                  <div className="space-y-4">
                    <ComparisonReport
                      columns={columns}
                      report={comparisonReport}
                      resolveLabel={resolvePipelineLabel}
                    />
                    {allCompleted && (
                      <SaveProjectCard
                        projectName={projectName}
                        onProjectNameChange={setProjectName}
                        savingProject={savingProject}
                        saveProjectMsg={saveProjectMsg}
                        saveProjectOk={saveProjectOk}
                        canSave={canSave}
                        onSave={() => void save()}
                      />
                    )}
                  </div>
                )}
                {mainTab === "report" && !hasMetrics && (
                  <div className="empty-state h-full min-h-[12rem]">
                    <div className="empty-state-icon">
                      <BarChart3 className="h-5 w-5" />
                    </div>
                    <p className="text-sm">{t("arena.stage.emptyReport")}</p>
                    <p className="text-xs text-muted-foreground">{t("arena.stage.emptyReportHint")}</p>
                  </div>
                )}
                {mainTab === "diff" && allCompleted && (
                  <TraceDiff columns={columnList} resolveLabel={resolvePipelineLabel} />
                )}
                {mainTab === "diff" && !allCompleted && (
                  <div className="empty-state h-full min-h-[12rem]">
                    <div className="empty-state-icon">
                      <GitCompare className="h-5 w-5" />
                    </div>
                    <p className="text-sm">{t("arena.stage.emptyDiff")}</p>
                    <p className="text-xs text-muted-foreground">{t("arena.stage.emptyDiffHint")}</p>
                  </div>
                )}
                {mainTab === "logs" && (
                  <LogsDiff columns={columnList} resolveLabel={resolvePipelineLabel} running={running} />
                )}
                {mainTab === "matrix" && <MatrixPanel setError={setError} />}
              </div>
            )}
          </div>
        </main>

        <aside
          className="arena-drawer"
          data-side="right"
          data-open={showRightPanel ? "true" : undefined}
          aria-label={t("arena.label.workspace")}
          aria-hidden={!showRightPanel}
          inert={!showRightPanel ? true : undefined}
        >
          <div className="arena-drawer-head">
            <p className="eyebrow">{t("arena.label.workspace")}</p>
            {workspaceChoices.length > 1 && (
              <UiSelect
                className="!h-7 min-w-0 flex-1 text-[11px]"
                value={workspaceFocusLabel ?? workspaceChoices[0]?.label ?? ""}
                onChange={(next) => setWorkspaceFocusLabel(next)}
                ariaLabel={t("arena.drawer.pickWorkspaceAria")}
                options={workspaceChoices.map((choice) => ({
                  value: choice.label,
                  label: resolvePipelineLabel(choice.label),
                }))}
              />
            )}
            <button
              type="button"
              className="btn-ghost !h-7 !w-7 !p-0"
              onClick={() => setShowRightPanel(false)}
              aria-label={t("arena.drawer.closeWorkspaceAria")}
              tabIndex={showRightPanel ? 0 : -1}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="arena-drawer-body !p-0 flex flex-col overflow-hidden">
            {focusedWorkspace ? (
              <WorkspacePanel
                workspaceName={focusedWorkspace}
                pollInterval={showRightPanel ? (running ? 1500 : 5000) : 0}
                refreshToken={workspaceRefreshToken}
              />
            ) : (
              <p className="px-3 py-4 text-xs text-muted-foreground">{t("arena.drawer.emptyWorkspace")}</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
