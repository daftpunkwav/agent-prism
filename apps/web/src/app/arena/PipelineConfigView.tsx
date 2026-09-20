/**
 * @file PipelineConfigView
 * @description Structured pipeline-config display: parsed banner chips plus a cross-column compare table.
 *
 * Responsibilities:
 * - Parse each column's Step-0 driver banner into framework / mode / field chips
 * - Render a union-field compare table that highlights differing cells
 *
 * Pure display over ColumnState events; banner parsing is the arena-view single source.
 */

"use client";

import { useMemo } from "react";
import { Cpu } from "lucide-react";
import { parsePipelineBanner, type ColumnState, type ParsedBanner } from "@agentprism/arena-view";
import { useT } from "@/i18n/useT";

/** First parseable driver banner of a column, if any. */
export function bannerOf(col: Pick<ColumnState, "events">): ParsedBanner | null {
  for (const event of col.events) {
    if (event.type !== "thought" && event.type !== "thought_delta") continue;
    const parsed = parsePipelineBanner(event.content);
    if (parsed) return parsed;
  }
  return null;
}

/** Framework badge + mode labels + key=value chips for one parsed banner. */
export function PipelineConfigBadges({ banner }: { banner: ParsedBanner }) {
  return (
    <span className="pipeline-badges">
      <span className="pipeline-framework">
        <Cpu className="h-3 w-3" aria-hidden />
        {banner.framework}
      </span>
      {banner.modes.map((mode) => (
        <span key={mode} className="pipeline-mode">
          {mode}
        </span>
      ))}
      {banner.fields.map((field) => (
        <span key={`${field.key}=${field.value}`} className="pipeline-field" title={`${field.key} = ${field.value}`}>
          <span className="pipeline-field-key">{field.key}</span>
          <span className="pipeline-field-value">{field.value}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Cross-column pipeline-config compare: one row per union field key, one column
 * per agent; cells whose value differs from the row's first value are marked.
 */
export function PipelineConfigCompare({
  columns,
  resolveLabel,
}: {
  columns: Array<Pick<ColumnState, "label" | "events">>;
  resolveLabel: (label: string) => string;
}) {
  const t = useT();
  const parsed = useMemo(
    () => columns.map((col) => ({ label: col.label, banner: bannerOf(col) })),
    [columns],
  );
  const keys = useMemo(() => {
    const seen: string[] = [];
    for (const entry of parsed) {
      for (const field of entry.banner?.fields ?? []) {
        if (!seen.includes(field.key)) seen.push(field.key);
      }
    }
    return seen;
  }, [parsed]);
  const frameworks = useMemo(
    () => parsed.map((entry) => entry.banner?.framework ?? ""),
    [parsed],
  );
  const frameworkDiffers = new Set(frameworks.filter(Boolean)).size > 1;

  if (parsed.every((entry) => entry.banner === null)) return null;

  return (
    <section className="panel-surface !shadow-none p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-semibold">{t("arena.pipeline.title")}</h4>
        {frameworkDiffers && <span className="pipeline-diff-mark">{t("arena.pipeline.differsMark")}</span>}
      </div>
      <div className="flex flex-col gap-2">
        {parsed.map((entry) => (
          <div key={entry.label} className="pipeline-badges-row">
            <span className="w-28 shrink-0 truncate text-xs font-medium">{resolveLabel(entry.label)}</span>
            {entry.banner ? (
              <PipelineConfigBadges banner={entry.banner} />
            ) : (
              <span className="text-[11px] italic text-muted-foreground">{t("arena.pipeline.noBanner")}</span>
            )}
          </div>
        ))}
      </div>
      {keys.length > 0 && (
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("arena.pipeline.colField")}</th>
                {parsed.map((entry) => (
                  <th key={entry.label} className="!text-center">
                    {resolveLabel(entry.label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const values = parsed.map(
                  (entry) => entry.banner?.fields.find((field) => field.key === key)?.value ?? "",
                );
                const first = values[0] ?? "";
                return (
                  <tr key={key}>
                    <td className="font-mono text-[11px] text-muted-foreground">{key}</td>
                    {values.map((value, index) => {
                      const differs = value !== first;
                      return (
                        <td
                          key={`${key}-${parsed[index]?.label ?? index}`}
                          className={
                            "text-center font-mono text-[11px] wrap-anywhere " +
                            (value === ""
                              ? "text-muted-foreground"
                              : differs
                                ? "pipeline-cell-diff"
                                : "text-foreground")
                          }
                        >
                          {value === "" ? "—" : value}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
