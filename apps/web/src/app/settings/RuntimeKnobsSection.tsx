/**
 * @file RuntimeKnobsSection
 * @description Settings section for operator-tunable runtime values (hot-applied).
 *
 * Responsibilities:
 * - Load the knob values plus field metadata from the settings API
 * - Render grouped number/select editors from the metadata
 * - Save through PUT; the server hot-applies without a restart
 */

"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import {
  fetchRuntimeKnobs,
  saveRuntimeKnobs,
  type RuntimeKnobFieldMeta,
  type RuntimeKnobsPayload,
} from "@agentprism/client";
import { UiSelect } from "@agentprism/ui";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n/catalogs/types";
import { Field } from "./Field";

type Draft = Record<string, number | string>;

const GROUPS: ReadonlyArray<{ id: RuntimeKnobFieldMeta["group"]; labelKey: MessageKey; descKey: MessageKey }> = [
  { id: "context", labelKey: "settings.runtime.groupContext", descKey: "settings.runtime.groupContextDesc" },
  { id: "reasoning", labelKey: "settings.runtime.groupReasoning", descKey: "settings.runtime.groupReasoningDesc" },
  { id: "harness", labelKey: "settings.runtime.groupHarness", descKey: "settings.runtime.groupHarnessDesc" },
  { id: "tools", labelKey: "settings.runtime.groupTools", descKey: "settings.runtime.groupToolsDesc" },
  { id: "llm", labelKey: "settings.runtime.groupLlm", descKey: "settings.runtime.groupLlmDesc" },
];

function fieldLabel(key: string): MessageKey {
  switch (key) {
    case "contextWindowMessages":
      return "settings.runtime.fields.contextWindowMessages";
    case "contextCharsPerToken":
      return "settings.runtime.fields.contextCharsPerToken";
    case "contextSummaryMaxChars":
      return "settings.runtime.fields.contextSummaryMaxChars";
    case "contextTokenBudgetChars":
      return "settings.runtime.fields.contextTokenBudgetChars";
    case "contextTokenBudgetKeepTurns":
      return "settings.runtime.fields.contextTokenBudgetKeepTurns";
    case "contextToolTailBudgetChars":
      return "settings.runtime.fields.contextToolTailBudgetChars";
    case "contextToolTailKeepChars":
      return "settings.runtime.fields.contextToolTailKeepChars";
    case "contextBudgetTokens":
      return "settings.runtime.fields.contextBudgetTokens";
    case "contextCheckpointTargetTokens":
      return "settings.runtime.fields.contextCheckpointTargetTokens";
    case "selfConsistencyN":
      return "settings.runtime.fields.selfConsistencyN";
    case "totWidth":
      return "settings.runtime.fields.totWidth";
    case "crewaiProcess":
      return "settings.runtime.fields.crewaiProcess";
    case "subagentMaxSteps":
      return "settings.runtime.fields.subagentMaxSteps";
    case "ralphMaxRounds":
      return "settings.runtime.fields.ralphMaxRounds";
    case "mcpFetchTimeoutMs":
      return "settings.runtime.fields.mcpFetchTimeoutMs";
    case "agentMaxDelegationDepth":
      return "settings.runtime.fields.agentMaxDelegationDepth";
    case "llmTimeoutMs":
      return "settings.runtime.fields.llmTimeoutMs";
    case "llmMaxRetries":
      return "settings.runtime.fields.llmMaxRetries";
    case "harnessRetries.verify":
      return "settings.runtime.fields.harnessRetries.verify";
    case "harnessRetries.reflect":
      return "settings.runtime.fields.harnessRetries.reflect";
    case "harnessRetries.selfEvolve":
      return "settings.runtime.fields.harnessRetries.selfEvolve";
    default:
      return "settings.runtime.desc";
  }
}

function flatten(knobs: RuntimeKnobsPayload["knobs"], fields: readonly RuntimeKnobFieldMeta[]): Draft {
  const draft: Draft = {};
  for (const meta of fields) {
    const parts = meta.key.split(".");
    let value: unknown = knobs as unknown as Record<string, unknown>;
    for (const part of parts) value = (value as Record<string, unknown>)[part];
    draft[meta.key] = typeof value === "number" || typeof value === "string" ? value : meta.default;
  }
  return draft;
}

/** Runtime knob editors; saving hot-applies on the server (no restart). */
export function RuntimeKnobsSection({ onFlash }: { onFlash(message: string): void }) {
  const t = useT();
  const [fields, setFields] = useState<readonly RuntimeKnobFieldMeta[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchRuntimeKnobs()
      .then((payload: RuntimeKnobsPayload) => {
        setFields(payload.fields);
        setDraft(flatten(payload.knobs, payload.fields));
      })
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const payload = await saveRuntimeKnobs(draft);
      setDraft(flatten(payload.knobs, payload.fields));
      onFlash(t("settings.runtime.saved"));
    } catch (error) {
      onFlash(error instanceof Error ? error.message : t("settings.runtime.saveFailed"));
    } finally {
      setSaving(false);
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
  if (loadError !== null) {
    return <p className="text-sm text-destructive">{loadError}</p>;
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.runtime.desc")}</p>
      {GROUPS.map((group) => {
        const groupFields = fields.filter((field) => field.group === group.id);
        if (groupFields.length === 0) return null;
        return (
          <div key={group.id} className="rounded-[var(--radius-sm)] border border-border/70 p-4 space-y-3">
            <p className="eyebrow">{t(group.labelKey)}</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{t(group.descKey)}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
              {groupFields.map((meta) => (
                <Field key={meta.key} label={t(fieldLabel(meta.key))}>
                  {meta.kind === "select" ? (
                    <UiSelect
                      className="w-full"
                      value={String(draft[meta.key] ?? meta.default)}
                      onChange={(value) => setDraft((d) => ({ ...d, [meta.key]: value }))}
                      ariaLabel={t(fieldLabel(meta.key))}
                      options={(meta.options ?? []).map((option) => ({ value: option, label: option }))}
                    />
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <input
                        className="form-input font-mono text-sm"
                        type="number"
                        min={meta.min}
                        max={meta.max}
                        step={meta.step}
                        value={String(draft[meta.key] ?? meta.default)}
                        onChange={(e) => {
                          const parsed = parseInt(e.target.value, 10);
                          setDraft((d) => ({ ...d, [meta.key]: Number.isFinite(parsed) ? parsed : meta.default as number }));
                        }}
                      />
                      <button
                        type="button"
                        className="btn-ghost !h-9 !w-9 !p-0 shrink-0"
                        title={t("settings.runtime.resetTitle")}
                        aria-label={t("settings.runtime.resetTitle")}
                        onClick={() => setDraft((d) => ({ ...d, [meta.key]: meta.default as number }))}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </Field>
              ))}
            </div>
          </div>
        );
      })}

      <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {t("settings.runtime.save")}
      </button>
    </div>
  );
}
