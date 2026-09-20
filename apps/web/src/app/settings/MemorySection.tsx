/**
 * @file MemorySection
 * @description Settings section showing the cross-session memory stores.
 *
 * Responsibilities:
 * - Load episodic/semantic entry counts and storage paths
 * - Offer a confirmed clear of both stores
 * - Point at the Arena memory dimension that now reads/writes these stores
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, Loader2, Trash2 } from "lucide-react";
import { clearMemory, fetchMemoryStatus, type MemoryStatus } from "@agentprism/client";
import { useT } from "@/i18n/useT";

/** Memory store status + maintenance. */
export function MemorySection({ onFlash }: { onFlash(message: string): void }) {
  const t = useT();
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback((): void => {
    fetchMemoryStatus()
      .then(setStatus)
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const onClear = async (): Promise<void> => {
    if (!window.confirm(t("settings.memory.confirmClear"))) return;
    setClearing(true);
    try {
      setStatus(await clearMemory());
      onFlash(t("settings.memory.cleared"));
    } catch (error) {
      onFlash(error instanceof Error ? error.message : t("settings.memory.clearFailed"));
    } finally {
      setClearing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("settings.page.loading")}
      </div>
    );
  }
  if (loadError !== null || status === null) {
    return <p className="text-sm text-destructive">{loadError ?? "Memory status unavailable"}</p>;
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.memory.desc")}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-[var(--radius-sm)] border border-border/70 p-4">
          <p className="eyebrow">{t("settings.memory.episodicTitle")}</p>
          <p className="mt-2 text-2xl font-mono">{status.episodicCount}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{t("settings.memory.episodicHint")}</p>
          <p className="mt-2 text-[11px] font-mono text-muted-foreground truncate" title={status.episodicPath}>
            {status.episodicPath}
          </p>
        </div>
        <div className="rounded-[var(--radius-sm)] border border-border/70 p-4">
          <p className="eyebrow">{t("settings.memory.semanticTitle")}</p>
          <p className="mt-2 text-2xl font-mono">{status.semanticCount}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{t("settings.memory.semanticHint")}</p>
          <p className="mt-2 text-[11px] font-mono text-muted-foreground truncate" title={status.semanticPath}>
            {status.semanticPath}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" onClick={reload} disabled={loading}>
          <Database className="h-4 w-4" />
          {t("settings.memory.refresh")}
        </button>
        <button
          type="button"
          className="btn-ghost text-destructive"
          disabled={clearing || (status.episodicCount === 0 && status.semanticCount === 0)}
          onClick={() => void onClear()}
        >
          {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          {t("settings.memory.clear")}
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">{t("settings.memory.arenaNote")}</p>
    </div>
  );
}
