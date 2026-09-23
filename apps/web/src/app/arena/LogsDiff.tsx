/**
 * @file LogsDiff
 * @description Cross-column comparison of per-run observability logs: captured LLM
 * wire traffic and the raw event stream.
 *
 * Responsibilities:
 * - Poll /api/arena/column-logs per column (live while the run streams, no blocking)
 * - Render the wire view: request/response/error records with full message payloads
 * - Render the raw-log view: one line per run event in arrival order
 *
 * Read-only over the runner's fail-open JSONL logs; unknown/missing logs render
 * as empty states so polling never surfaces errors mid-run.
 */

"use client";

import { memo, useState } from "react";
import { ArrowLeftRight, Braces, FileJson, ScrollText } from "lucide-react";
import type { ArenaEvent, WireLogEntry } from "@agentprism/client";
import type { ColumnState } from "@agentprism/arena-view";
import { useT } from "@/i18n/useT";
import { useColumnLogs } from "./useColumnLogs";

interface LogsDiffProps {
  columns: Array<ColumnState>;
  /** Locale overlay for pipeline aggregation keys. */
  resolveLabel?: (label: string) => string;
  /** Live pulse: polls faster while any column is still streaming. */
  running: boolean;
}

type LogsViewMode = "wire" | "events";

/** Render-side cap: max characters shown for one log field before visual truncation (distinct from the capture-side cap in the provider tracer). */
const RENDER_FIELD_CAP = 20_000;

/** One-line summary of a run event for the raw-log view. */
function eventLine(event: ArenaEvent): string {
  const parts: string[] = [];
  const turn = event.turn ?? 0;
  const step = event.step ?? 0;
  if (turn > 0 || step > 0) parts.push(`t${turn}/s${step}`);
  parts.push(event.type);
  if (event.tool) parts.push(event.tool);
  const text = event.content || event.result || event.message || "";
  if (text !== "") {
    const flat = text.replace(/\s+/g, " ").trim();
    parts.push(flat.length > 160 ? `${flat.slice(0, 160)}…` : flat);
  }
  return parts.join(" · ");
}

/**
 * One request/response wire record block. The expansion renders the captured
 * payload as-is (pretty-printed JSON) — the wire view is an inspection surface,
 * so fidelity beats prettification.
 */
const WireEntry = memo(function WireEntry({ entry }: { entry: WireLogEntry }) {
  const t = useT();
  const { record } = entry;
  if (record.kind === "llm_error") {
    return (
      <div className="trace-seg trace-error" data-kind="error">
        <span className="trace-tag font-mono">
          {t("arena.logs.kindError")} · #{entry.seq} · t{entry.turn}
        </span>
        <p className="whitespace-pre-wrap break-words text-xs text-destructive">
          {String(record.data.error ?? "")}
        </p>
      </div>
    );
  }
  const isRequest = record.kind === "llm_request";
  const model = String(record.data.model ?? "");
  const messages = Array.isArray(record.data.messages) ? record.data.messages : [];
  const usage = (record.data.usage ?? null) as { total_tokens?: number } | null;
  const toolCalls = Array.isArray(record.data.tool_calls) ? record.data.tool_calls : [];
  const durationMs = record.durationMs;
  return (
    <details className="trace-seg trace-action" data-kind="wire" data-record={record.kind}>
      <summary className="trace-tag cursor-pointer select-none flex items-center gap-1.5 flex-wrap font-mono">
        <Chevronish />
        <span
          className="rounded-[var(--radius-sm)] border px-1.5 py-0.5"
          style={{
            borderColor: isRequest ? "var(--chart-1)" : "var(--success)",
            color: isRequest ? "var(--chart-1)" : "var(--success)",
          }}
        >
          {isRequest ? t("arena.logs.kindRequest") : t("arena.logs.kindResponse")}
        </span>
        <span className="rounded-[var(--radius-sm)] border border-border px-1.5 py-0.5 text-muted-foreground">
          t{entry.turn}
        </span>
        <span className="text-foreground">{model}</span>
        <span className="text-muted-foreground">
          {isRequest
            ? t("arena.logs.messagesCount", { count: messages.length })
            : `${toolCalls.length > 0 ? `${t("arena.logs.toolCallsCount", { count: toolCalls.length })} · ` : ""}${usage?.total_tokens ? `${t("arena.logs.tokensCount", { count: usage.total_tokens })} · ` : ""}${durationMs !== null ? `${durationMs}ms` : ""}`}
        </span>
      </summary>
      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-none border border-border bg-muted/30 p-2 text-[11px] leading-relaxed text-muted-foreground">
        {clipField(JSON.stringify(record.data, null, 2))}
      </pre>
    </details>
  );
});

function Chevronish() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="trace-chevron h-3 w-3" aria-hidden>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function clipField(text: string): string {
  return text.length > RENDER_FIELD_CAP ? `${text.slice(0, RENDER_FIELD_CAP)}\n…[truncated]` : text;
}

/** One column's wire/log card. */
function ColumnLogsCard({
  column,
  view,
  running,
  resolveLabel,
}: {
  column: ColumnState;
  view: LogsViewMode;
  running: boolean;
  resolveLabel: (label: string) => string;
}) {
  const t = useT();
  // A settled column's logs are final: poll only while it has no metrics yet.
  const pollMs = running && column.metrics === undefined ? 2000 : 0;
  const logs = useColumnLogs(column.workspace, column.label, pollMs);
  return (
    <div className="panel-surface !shadow-none p-3 space-y-2 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-sm truncate">{resolveLabel(column.label)}</span>
        {column.workspace && (
          <span className="font-mono text-[11px] text-muted-foreground truncate">{column.workspace}</span>
        )}
        {running && <span className="column-status-dot running" aria-hidden />}
      </div>
      {!column.workspace ? (
        <p className="text-[11px] italic text-muted-foreground">{t("arena.logs.needWorkspace")}</p>
      ) : logs === null ? (
        <p className="text-[11px] italic text-muted-foreground">{t("arena.logs.loading")}</p>
      ) : view === "wire" ? (
        logs.wire.length === 0 ? (
          <p className="text-[11px] italic text-muted-foreground">{t("arena.logs.emptyWire")}</p>
        ) : (
          <div className="space-y-1.5">
            {logs.wire.map((entry, index) => (
              // seq restarts per run file; ts+seq+index stays unique across merged turns.
              <WireEntry key={`${entry.ts}_${entry.seq}_${index}`} entry={entry} />
            ))}
          </div>
        )
      ) : logs.events.length === 0 ? (
        <p className="text-[11px] italic text-muted-foreground">{t("arena.logs.emptyEvents")}</p>
      ) : (
        <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-none border border-border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {logs.events.map(eventLine).join("\n")}
          {logs.truncated ? `\n${t("arena.trace.truncatedMark")}` : ""}
        </pre>
      )}
    </div>
  );
}

/**
 * Cross-column wire/log comparison. Unlike the trace diff this stays available
 * while the run streams: each card polls its own column tail independently.
 */
export function LogsDiff({ columns, resolveLabel, running }: LogsDiffProps) {
  const t = useT();
  const show = (label: string) => (resolveLabel ? resolveLabel(label) : label);
  const [view, setView] = useState<LogsViewMode>("wire");
  const viewButton = (mode: LogsViewMode, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => setView(mode)}
      className={
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-0.5 text-[11px] transition-colors " +
        (view === mode
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:text-foreground")
      }
      aria-pressed={view === mode}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <section className="space-y-3 fade-in">
      <div className="px-1 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-primary" />
          <h3 className="page-title text-sm">{t("arena.logs.title")}</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {viewButton("wire", t("arena.logs.viewWire"), <FileJson className="h-3 w-3" aria-hidden />)}
          {viewButton("events", t("arena.logs.viewEvents"), <ScrollText className="h-3 w-3" aria-hidden />)}
        </div>
      </div>
      {columns.length === 0 ? (
        <div className="empty-state h-full min-h-[12rem]">
          <div className="empty-state-icon">
            <Braces className="h-5 w-5" />
          </div>
          <p className="text-sm">{t("arena.logs.emptyAll")}</p>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))" }}>
          {columns.map((column) => (
            <ColumnLogsCard
              key={column.label}
              column={column}
              view={view}
              running={running}
              resolveLabel={show}
            />
          ))}
        </div>
      )}
    </section>
  );
}
