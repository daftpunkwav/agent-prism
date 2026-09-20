/**
 * @file sessions/page
 * @description The /sessions route page.
 *
 * Responsibilities:
 * - List durable execution sessions with status, summary, and milestones
 * - Expand milestone entries on demand and delete records
 */

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Download, History, Trash2, Zap } from "lucide-react";
import {
  deleteSession,
  exportSession,
  getSessionDetail,
  getSessionStats,
  listSessions,
  type SessionEntry,
  type SessionKind,
  type SessionRecord,
  type SessionStats,
  type SessionStatus,
} from "@agentprism/client";
import { formatDateTime } from "@/i18n/format";
import { useLocale, useT } from "@/i18n/useT";

/** Run-history route: ledger filters, stats strip, milestone expansion, export, delete. */
export default function SessionsPage() {
  const t = useT();
  const locale = useLocale();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [kindFilter, setKindFilter] = useState<"" | SessionKind>("");
  const [statusFilter, setStatusFilter] = useState<"" | SessionStatus>("");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, SessionEntry[]>>({});
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    (async () => {
      try {
        const [listed, fetchedStats] = await Promise.all([
          listSessions(
            {
              ...(kindFilter === "" ? {} : { kind: kindFilter }),
              ...(statusFilter === "" ? {} : { status: statusFilter }),
            },
            ac.signal,
          ),
          getSessionStats(ac.signal),
        ]);
        if (ac.signal.aborted) return;
        setSessions(listed);
        setStats(fetchedStats);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message);
        }
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [kindFilter, statusFilter]);

  const onToggleEntries = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (entries[id] !== undefined) return;
    try {
      const detail = await getSessionDetail(id);
      setEntries((prev) => ({ ...prev, [id]: [...detail.entries] }));
    } catch (err) {
      setError((err as Error).message);
      setExpanded(null);
    }
  };

  const onExport = async (session: SessionRecord) => {
    setError(null);
    try {
      const envelope = await exportSession(session.id);
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `session-${session.id}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm(t("sessions.deleteConfirm"))) return;
    setDeleting(id);
    setError(null);
    try {
      await deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (expanded === id) setExpanded(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(null);
    }
  };

  const kindLabel = (kind: SessionRecord["kind"]) =>
    kind === "arena" ? t("sessions.kind.arena") : kind === "agent" ? t("sessions.kind.agent") : t("sessions.kind.builder");
  const statusLabel = (status: SessionRecord["status"]) =>
    status === "active"
      ? t("sessions.status.active")
      : status === "completed"
        ? t("sessions.status.completed")
        : status === "failed"
          ? t("sessions.status.failed")
          : t("sessions.status.cancelled");

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
        <div className="loading-prism" aria-hidden />
        <p className="text-sm">{t("sessions.loading")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 fade-in">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow mb-2">Ledger</p>
          <h1 className="page-title text-3xl">{t("sessions.title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-lg leading-relaxed">{t("sessions.desc")}</p>
        </div>
        <Link href="/arena" className="btn-primary">
          <Zap className="h-4 w-4" />
          {t("sessions.newExperiment")}
        </Link>
      </div>

      <div className="spectrum-line-soft" aria-hidden />

      <div className="flex items-center gap-2 flex-wrap">
        <select
          className="form-input !h-9 !w-auto !px-2 !text-xs"
          aria-label={t("sessions.filterKindAria")}
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as "" | SessionKind)}
        >
          <option value="">{t("sessions.filterAllKinds")}</option>
          <option value="arena">{t("sessions.kind.arena")}</option>
          <option value="agent">{t("sessions.kind.agent")}</option>
          <option value="builder">{t("sessions.kind.builder")}</option>
        </select>
        <select
          className="form-input !h-9 !w-auto !px-2 !text-xs"
          aria-label={t("sessions.filterStatusAria")}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | SessionStatus)}
        >
          <option value="">{t("sessions.filterAllStatuses")}</option>
          <option value="active">{t("sessions.status.active")}</option>
          <option value="completed">{t("sessions.status.completed")}</option>
          <option value="failed">{t("sessions.status.failed")}</option>
          <option value="cancelled">{t("sessions.status.cancelled")}</option>
        </select>
      </div>

      {stats !== null && sessions.length > 0 && (
        <p className="text-xs font-mono text-muted-foreground">
          {t("sessions.statsLine", {
            total: stats.total,
            active: stats.byStatus.active,
            completed: stats.byStatus.completed,
            failed: stats.byStatus.failed,
            cancelled: stats.byStatus.cancelled,
          })}
        </p>
      )}

      {error && (
        <p className="text-xs text-destructive border border-destructive/30 bg-destructive/5 rounded-[var(--radius-sm)] px-3 py-2">
          {error}
        </p>
      )}

      {sessions.length === 0 ? (
        <div className="panel-surface empty-state py-20">
          <div className="empty-state-icon !w-14 !h-14">
            <History className="h-6 w-6" />
          </div>
          <p className="text-sm text-foreground font-medium">{t("sessions.empty.title")}</p>
          <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">{t("sessions.empty.desc")}</p>
          <Link href="/arena" className="btn-primary mt-2">
            <Zap className="h-4 w-4" />
            {t("sessions.empty.cta")}
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 stagger-children">
          {sessions.map((session, idx) => (
            <article
              key={session.id}
              className="panel-surface panel-lift p-5 relative overflow-hidden group"
              style={{
                ["--lane" as string]: `var(--spectrum-${(idx % 4) + 1})`,
              }}
            >
              <span
                className="absolute inset-x-0 top-0 h-0.5 opacity-80"
                style={{ background: "var(--lane)" }}
                aria-hidden
              />
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <History className="h-4 w-4 text-primary shrink-0" />
                    <h2 className="font-semibold text-sm truncate min-w-0">{session.title}</h2>
                    <span className="text-[11px] font-mono text-muted-foreground shrink-0 rounded-none px-1.5 py-0.5 bg-muted border border-border">
                      {kindLabel(session.kind)}
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground shrink-0 rounded-none px-1.5 py-0.5 bg-muted border border-border">
                      {statusLabel(session.status)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3 line-clamp-2 leading-relaxed">
                    {session.summary ?? t("sessions.noSummary")}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-muted-foreground">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => onToggleEntries(session.id)}
                      aria-expanded={expanded === session.id}
                    >
                      <ChevronDown
                        className={`h-3 w-3 transition-transform ${expanded === session.id ? "rotate-180" : ""}`}
                      />
                      {t("sessions.entries", { count: session.entryCount })}
                      <span className="sr-only">
                        {expanded === session.id ? t("sessions.hideEntries") : t("sessions.showEntries")}
                      </span>
                    </button>
                  </div>
                  {expanded === session.id &&
                    (() => {
                      // Detail fetch in flight: never flash the empty state.
                      const detail = entries[session.id];
                      return (
                        <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
                          {detail === undefined ? (
                            <li className="text-xs text-muted-foreground">{t("sessions.loadingEntries")}</li>
                          ) : detail.length === 0 ? (
                            <li className="text-xs text-muted-foreground">{t("sessions.noEntries")}</li>
                          ) : (
                            detail.map((entry) => (
                              <li key={entry.seq} className="text-xs text-muted-foreground leading-relaxed">
                                <span className="font-mono text-[11px] text-muted-foreground mr-2">
                                  #{entry.seq} · {entry.kind}
                                </span>
                                {entry.content}
                              </li>
                            ))
                          )}
                        </ul>
                      );
                    })()}
                  <p className="text-[11px] text-muted-foreground mt-2.5 font-mono">
                    {formatDateTime(locale, new Date(session.createdAt).toISOString())}
                  </p>
                </div>
                <div className="flex flex-col gap-1 shrink-0 opacity-60 group-hover:opacity-100">
                  <button
                    type="button"
                    className="btn-ghost !h-8 !w-8 !p-0"
                    onClick={() => onExport(session)}
                    aria-label={t("sessions.exportAria", { name: session.title })}
                    title={t("sessions.exportAction")}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn-ghost !h-8 !w-8 !p-0"
                    onClick={() => onDelete(session.id)}
                    disabled={deleting === session.id}
                    aria-label={t("sessions.deleteAria", { name: session.title })}
                  >
                    {deleting === session.id ? (
                      <div className="h-3 w-3 border border-foreground/30 border-t-foreground rounded-full animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
