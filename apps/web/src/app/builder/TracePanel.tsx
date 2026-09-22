/**
 * @file TracePanel
 * @description The observability panel: timeline, LLM wire pairs, raw log.
 *
 * Responsibilities:
 * - Render the session's whole execution trail: settled turns as flat step rows,
 *   hot-swap banners interleaved chronologically, and the live turn tail
 * - Render LLM request/response rounds as color-coded collapsed blocks
 *   (request = lane blue, response = lane teal) with full payloads on expand
 * - Render every trace entry and arena event as the raw log
 *
 * Presentation only: data arrives via props from the streamed session state.
 * Settled turns come from the persisted journal, so the trail accumulates
 * across turns and restarts instead of resetting on every message.
 */

"use client";

import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { ArenaEvent, BuilderTraceEntry } from "@agentprism/client";
import {
  asRequest,
  asResponse,
  eventRow,
  firstTokenMs,
  llmRounds,
  segmentsOf,
  traceAccent,
  traceRow,
  type LogRow,
  type TurnGroup,
} from "./builderTrace";
import { PhaseGroups, SegmentList } from "./ChatPanel";
import { WorkspacePanel } from "../arena/WorkspacePanel";
import { useT } from "@/i18n/useT";

export type TraceTab = "timeline" | "llm" | "log" | "workspace";

export interface TracePanelProps {
  /** Every trace entry of the session: journal records merged with live SSE entries. */
  trace: BuilderTraceEntry[];
  /** Settled turns from the persisted journal (user message + raw events each). */
  turns: TurnGroup[];
  /** Arena events of the live turn (empty when idle). */
  events: ArenaEvent[];
  tab: TraceTab;
  onTabChange: (tab: TraceTab) => void;
  /** Active session workspace (null before the first turn creates one). */
  workspaceName?: string | null;
  /** Bumped on file-diff/observation events for instant workspace refresh. */
  workspaceRefreshToken?: number;
}

/** Raw-log row ceiling: the newest entries survive, the cut is labeled, never silent. */
const LOG_ROW_LIMIT = 400;

function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="chip-toggle"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? t("builder.copied") : t("builder.copy")}
    </button>
  );
}

function JsonBlock({ payload }: { payload: unknown }) {
  const text = useMemo(() => JSON.stringify(payload, null, 2), [payload]);
  return (
    <div className="builder-json-wrap">
      <div className="builder-json-bar">
        <CopyButton text={text} />
      </div>
      <pre className="builder-json">{text}</pre>
    </div>
  );
}

/** One hot-swap entry as a chronological banner inside the timeline. */
function SwapBanner({ entry }: { entry: BuilderTraceEntry }) {
  const t = useT();
  return (
    <details className="builder-swap-banner">
      <summary className="builder-swap-banner-summary">
        <RefreshCw size={12} aria-hidden />
        <span>{t("builder.swapBanner")}</span>
        <span className="builder-swap-banner-detail">{entry.title}</span>
      </summary>
      <JsonBlock payload={entry.data} />
    </details>
  );
}

/** One settled turn of the trail: user message header plus its flat step rows. */
function TurnBlock({ group }: { group: TurnGroup }) {
  const t = useT();
  const segments = useMemo(() => segmentsOf(group.events), [group.events]);
  if (segments.length === 0) return null;
  return (
    <div className="builder-timeline-turn">
      <div className="builder-timeline-turn-head">
        <span className="builder-timeline-turn-label">{t("builder.turnLabel", { turn: group.turn })}</span>
        <span className="builder-timeline-turn-user">{group.user}</span>
      </div>
      <PhaseGroups segments={segments} />
    </div>
  );
}

function Timeline({ turns, trace, events }: { turns: TurnGroup[]; trace: BuilderTraceEntry[]; events: ArenaEvent[] }) {
  const t = useT();
  // Chronology across the trail: settled turns and hot-swaps interleave by timestamp.
  const items = useMemo(() => {
    const swapItems = trace
      .filter((entry) => entry.kind === "swap")
      .map((entry) => ({ ts: entry.ts, kind: "swap" as const, entry }));
    const turnItems = turns.map((group) => ({ ts: group.ts, kind: "turn" as const, group }));
    return [...swapItems, ...turnItems].sort((a, b) => a.ts - b.ts);
  }, [turns, trace]);
  if (items.length === 0 && events.length === 0) {
    return <div className="builder-trace-empty">{t("builder.emptyTrace")}</div>;
  }
  return (
    <div className="builder-timeline">
      {items.map((item) =>
        item.kind === "swap" ? (
          <SwapBanner key={`swap-${item.entry.id}`} entry={item.entry} />
        ) : (
          <TurnBlock key={`turn-${item.group.turn}`} group={item.group} />
        ),
      )}
      {events.length > 0 ? (
        <div className="builder-timeline-live">
          <div className="builder-timeline-live-head">
            <span className="eyebrow">{t("builder.liveTrace")}</span>
          </div>
          <SegmentList segments={segmentsOf(events)} running />
        </div>
      ) : null}
    </div>
  );
}

function WireTab({ trace }: { trace: BuilderTraceEntry[] }) {
  const t = useT();
  const rounds = useMemo(() => llmRounds(trace), [trace]);
  if (rounds.length === 0) {
    return <div className="builder-trace-empty">{t("builder.noLlmTraffic")}</div>;
  }
  return (
    <div className="builder-rounds">
      {rounds.map((round, index) => {
        const request = round.request !== null ? asRequest(round.request) : null;
        const response = round.response !== null ? asResponse(round.response) : null;
        const firstToken = round.response !== null ? firstTokenMs(round.response) : null;
        const responsePreview = (response?.text ?? "").replace(/\s+/g, " ").trim();
        // The latest round opens by default: the one you are most likely debugging.
        const open = index === rounds.length - 1;
        const params = request?.params as Record<string, unknown> | undefined;
        const paramKeys = params === undefined ? [] : Object.keys(params);
        return (
          <div key={round.request?.id ?? round.response?.id ?? index} className="builder-round">
            <div className="builder-round-head">
              <span className="builder-round-badge">{`${t("builder.llmPair")} ${index + 1}`}</span>
              <span className="builder-round-meta">
                {response?.usage?.input_tokens !== undefined && response.usage.output_tokens !== undefined
                  ? `${response.usage.input_tokens}→${response.usage.output_tokens} tok`
                  : ""}
                {firstToken !== null ? ` · ${t("builder.firstToken")} ${firstToken}ms` : ""}
                {round.response !== null && round.response.durationMs !== null
                  ? ` · ${t("builder.latency")} ${round.response.durationMs}ms`
                  : ""}
              </span>
            </div>
            {request !== null ? (
              <details className="builder-msg-block" data-side="request" open={open}>
                <summary className="builder-msg-summary">
                  <span className="builder-msg-arrow" aria-hidden>
                    →
                  </span>
                  <span className="builder-msg-label">{t("builder.request")}</span>
                  <span className="builder-msg-detail">
                    {`${request.model ?? "model"} · ${request.messages?.length ?? 0} ${t("builder.messages")} · ${t("builder.tools")} ×${request.tools?.length ?? 0}`}
                    {paramKeys.length > 0 ? ` · temp ${String(params?.temperature ?? "—")}` : ""}
                  </span>
                </summary>
                <JsonBlock payload={request} />
              </details>
            ) : null}
            {round.response !== null ? (
              <details className="builder-msg-block" data-side="response" open={open}>
                <summary className="builder-msg-summary">
                  <span className="builder-msg-arrow" aria-hidden>
                    ←
                  </span>
                  <span className="builder-msg-label">{t("builder.response")}</span>
                  <span className="builder-msg-detail">
                    {responsePreview !== "" ? truncate(responsePreview, 140) : "…"}
                  </span>
                </summary>
                <JsonBlock payload={round.response.data} />
              </details>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function LogTab({ trace, turns, events }: { trace: BuilderTraceEntry[]; turns: TurnGroup[]; events: ArenaEvent[] }) {
  const t = useT();
  const rows = useMemo<LogRow[]>(() => {
    // Raw log = every trace entry plus every arena event (settled journal events
    // and the live tail alike), merged in timestamp order.
    const settledEvents = turns.flatMap((group) => group.events);
    const merged: LogRow[] = [
      ...trace.map(traceRow),
      ...settledEvents.map(eventRow),
      ...events.map(eventRow),
    ];
    merged.sort((a, b) => a.ts - b.ts);
    return merged;
  }, [trace, turns, events]);
  if (rows.length === 0) {
    return <div className="builder-trace-empty">{t("builder.emptyTrace")}</div>;
  }
  const capped = rows.length > LOG_ROW_LIMIT;
  const visible = capped ? rows.slice(rows.length - LOG_ROW_LIMIT) : rows;
  return (
    <div className="builder-log">
      {capped && (
        <p className="builder-log-capped">{t("builder.logCapped", { shown: visible.length, total: rows.length })}</p>
      )}
      {visible.map((row, index) => (
        <details key={index} className="builder-log-row">
          <summary className="builder-log-summary">
            <span className="builder-log-kind" style={{ color: row.source === "trace" ? traceAccent(row.entry.kind) : undefined }}>
              {row.label}
            </span>
            <span className="builder-log-detail">{row.detail}</span>
          </summary>
          <JsonBlock payload={row.source === "trace" ? row.entry : row.event} />
        </details>
      ))}
    </div>
  );
}

/**
 * Builder observability panel: timeline, LLM wire, raw log, and workspace tabs.
 *
 * @param trace Session-wide trace entries (journal + live merged).
 * @param turns Settled turns of the persisted journal.
 * @param events Arena events of the live turn.
 * @param tab Active tab id.
 * @param onTabChange Tab switch handler.
 */
export function TracePanel({ trace, turns, events, tab, onTabChange, workspaceName, workspaceRefreshToken }: TracePanelProps) {
  const t = useT();
  const tabs: Array<{ id: TraceTab; label: string }> = [
    { id: "timeline", label: t("builder.tabTimeline") },
    { id: "llm", label: t("builder.tabLlm") },
    { id: "log", label: t("builder.tabLog") },
    { id: "workspace", label: t("builder.tabWorkspace") },
  ];
  return (
    <div className="builder-trace">
      <div className="builder-trace-tabs">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="seg-tab"
            data-active={tab === entry.id}
            onClick={() => onTabChange(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className="builder-trace-body">
        {tab === "timeline" ? <Timeline turns={turns} trace={trace} events={events} /> : null}
        {tab === "llm" ? <WireTab trace={trace} /> : null}
        {tab === "log" ? <LogTab trace={trace} turns={turns} events={events} /> : null}
        {tab === "workspace" ? (
          <div className="builder-workspace-tab">
            <WorkspacePanel
              workspaceName={workspaceName ?? null}
              pollInterval={4000}
              refreshToken={workspaceRefreshToken ?? 0}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
