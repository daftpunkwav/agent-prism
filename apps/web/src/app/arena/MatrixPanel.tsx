/**
 * @file MatrixPanel
 * @description One-click comparison matrix panel: run, progress, scoreboard.
 *
 * Responsibilities:
 * - Run all scored templates through useMatrixRun with stop support
 * - Render per-cell progress plus the final score/tokens/tools table
 */

"use client";

import { useT } from "@/i18n/useT";
import { useMatrixRun } from "./useMatrixRun";

export function MatrixPanel({ setError }: { setError: (message: string) => void }) {
  const t = useT();
  const { running, progress, cells, elapsedSecs, start, stop } = useMatrixRun(setError);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-3">
        {running ? (
          <button type="button" onClick={stop} className="btn-primary btn-danger">
            {t("arena.matrix.stop")}
          </button>
        ) : (
          <button type="button" onClick={() => void start()} className="btn-primary">
            {t("arena.matrix.runAll")}
          </button>
        )}
        {running && <span className="text-sm text-muted-foreground">{t("arena.matrix.running")}</span>}
        {elapsedSecs !== null && !running && (
          <span className="text-sm text-muted-foreground">{t("arena.matrix.elapsed", { secs: elapsedSecs })}</span>
        )}
      </div>

      {progress.length === 0 && cells.length === 0 && !running && (
        <p className="text-sm text-muted-foreground">{t("arena.matrix.empty")}</p>
      )}

      {progress.length > 0 && (
        <ul className="space-y-1 text-sm">
          {progress.map((p) => (
            <li key={p.templateId}>
              <span className="font-mono">{p.templateId}</span> — {p.status}
              {p.score ? ` (${p.score})` : ""}
              {p.error ? ` — ${p.error}` : ""}
            </li>
          ))}
        </ul>
      )}

      {cells.length > 0 && (
        <div className="data-table-wrap">
        <table className="text-sm">
          <thead>
            <tr>
              <th>{t("arena.matrix.colTemplate")}</th>
              <th>{t("arena.matrix.colScore")}</th>
              <th>{t("arena.matrix.colTokens")}</th>
              <th>{t("arena.matrix.colTools")}</th>
              <th>{t("arena.matrix.colColumns")}</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((cell) => (
              <tr key={cell.template_id}>
                <td className="font-mono">{cell.template_id}</td>
                <td>
                  {cell.score.passed}/{cell.score.total}
                </td>
                <td>{cell.metrics?.total_tokens ?? "-"}</td>
                <td>{cell.metrics?.tool_calls ?? "-"}</td>
                <td>
                  {Object.entries(cell.columns)
                    .sort(([a], [b]) => (a < b ? -1 : 1))
                    .map(([label, passed]) => `${label}=${passed ? "pass" : "FAIL"}`)
                    .join(", ") || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
