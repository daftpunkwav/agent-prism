/**
 * @file DecodeDefaultsPanel
 * @description Arena-drawer decode-defaults editor (Settings uses a separate DecodeDefaultsSection) with commit-on-release sliders.
 *
 * Responsibilities:
 * - Edit decode defaults via commit-on-release slider controls
 * - Track save generations
 * - Display the token-usage estimate
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Gauge, Info, Loader2 } from "lucide-react";
import {
  DECODE_FIELD_RANGES,
  fetchProvider,
  providerUpdateFromPublic,
  saveProvider,
} from "@agentprism/client";
import { estimatePromptTokens, SAMPLE_SYSTEM, SAMPLE_USER } from "./tokenEstimate";
import { useT } from "@/i18n/useT";
import type { ProviderConfig } from "@agentprism/client";

interface DecodeDefaultsPanelProps {
  columnCount: number;
  /** Dimension purpose description: single source from backend meta (ArenaMeta.dimensions[].subtitle). */
  description: string;
}

interface ExperimentParams {
  temperature: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  max_tokens: number;
}

const DEFAULT_PARAMS: ExperimentParams = {
  temperature: 0,
  top_p: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
  max_tokens: 2048,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Read-only decode-default preview (temperature/top-p/penalties/max tokens).
 *
 * @param columnCount Active column count shown in the panel header.
 * @param description Dimension purpose from backend meta subtitles.
 */
export function DecodeDefaultsPanel({ columnCount, description }: DecodeDefaultsPanelProps) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [showEstimate, setShowEstimate] = useState(false);
  const [pending, setPending] = useState<ExperimentParams | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [errorDetail, setErrorDetail] = useState("");
  // Save only after the user releases the control (drag/keyboard/touch)
  const pendingRef = useRef<ExperimentParams | null>(null);
  // Save generation: continued dragging within the save window and stale responses never write back snapshots
  const flushSeqRef = useRef(0);

  useEffect(() => {
    // Cancel in-flight requests on unmount to avoid setState on unmounted
    const ac = new AbortController();
    fetchProvider({ signal: ac.signal })
      .then((cfg) => {
        if (ac.signal.aborted) return;
        setConfig(cfg);
        setPending({
          temperature: cfg.temperature,
          top_p: cfg.top_p ?? DEFAULT_PARAMS.top_p,
          frequency_penalty: cfg.frequency_penalty ?? DEFAULT_PARAMS.frequency_penalty,
          presence_penalty: cfg.presence_penalty ?? DEFAULT_PARAMS.presence_penalty,
          max_tokens: cfg.max_output_tokens,
        });
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(true);
        setErrorDetail(err.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, []);

  // The estimate is a lightweight regex count, recomputed on every render; config only gates loading
  const promptTokensPerColumn = estimatePromptTokens(SAMPLE_SYSTEM, SAMPLE_USER);
  const estimatedTokens = config ? promptTokensPerColumn * columnCount : 0;

  const flushParams = async () => {
    if (!config || pendingRef.current === null) return;
    const params = pendingRef.current;
    pendingRef.current = null;
    const seq = ++flushSeqRef.current;
    setSaving(true);
    setError(false);
    setErrorDetail("");
    try {
      // Only update shared decode defaults; the endpoint list round-trips wholesale through the single-source mapper (empty keys are kept by
      // the backend; thinking capability/website link fields are enforced by the return type and never silently reset by schema defaults)
      const saved = await saveProvider(
        providerUpdateFromPublic(config, {
          temperature: params.temperature,
          top_p: params.top_p,
          frequency_penalty: params.frequency_penalty,
          presence_penalty: params.presence_penalty,
          max_output_tokens: params.max_tokens,
        }),
      );
      // Stale responses (a later flush happened) or new edits within the save window never write back snapshots, so user input is never swallowed
      if (seq !== flushSeqRef.current || pendingRef.current !== null) return;
      setConfig(saved);
      setPending({
        temperature: saved.temperature,
        top_p: saved.top_p ?? params.top_p,
        frequency_penalty: saved.frequency_penalty ?? params.frequency_penalty,
        presence_penalty: saved.presence_penalty ?? params.presence_penalty,
        max_tokens: saved.max_output_tokens,
      });
    } catch (err) {
      setError(true);
      setErrorDetail(err instanceof Error ? err.message : t("arena.decode.saveFailed"));
    } finally {
      // A stale flush leaves the saving indicator alone; the latest flush finalizes it
      if (seq === flushSeqRef.current) setSaving(false);
    }
  };

  const updateParam = <K extends keyof ExperimentParams>(
    key: K,
    value: ExperimentParams[K],
  ) => {
    setPending((prev) => {
      const next = { ...(prev ?? DEFAULT_PARAMS), [key]: value };
      pendingRef.current = next;
      return next;
    });
  };

  const params = pending ?? DEFAULT_PARAMS;
  // The slider's right endpoint grows with the current value (existing backend config can exceed default levels); right cap is shared (maxTokensSliderMax); left 64 label is hardcoded and may lag contracts/decode-options.ts
  const maxTokensSliderMax = Math.max(64000, params.max_tokens);

  const inputPct = useMemo(() => {
    if (!config || config.max_input_tokens <= 0) return 0;
    return Math.min(100, Math.round((estimatedTokens / config.max_input_tokens) * 100));
  }, [config, estimatedTokens]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        {t("arena.decode.loading")}
      </div>
    );
  }

  if (!config) {
    // On initial load failure (error=true) config is null; without a message the drawer would be silently blank
    if (error) {
      return (
        <div className="flex flex-col items-center gap-1.5 py-6 text-center">
          <p className="text-xs text-destructive">
            {errorDetail
              ? t("arena.decode.loadFailedDetail", { detail: errorDetail })
              : t("arena.decode.loadFailed")}
          </p>
          <p className="text-[11px] text-muted-foreground">{t("arena.decode.loadFailedHint")}</p>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow mb-2">{t("arena.label.params")}</p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {t("arena.decode.desc")}
        </p>
      </div>
      {/* Default endpoint summary */}
      <div className="rounded-[var(--radius-sm)] border border-border bg-muted/30 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="eyebrow">{t("arena.decode.defaultEndpoint")}</span>
          {saving && <span className="text-[11px] text-muted-foreground">{t("arena.action.saving")}</span>}
          {error && <span className="text-[11px] text-destructive">{errorDetail || t("arena.decode.saveFailed")}</span>}
        </div>
        <div className="rounded-[var(--radius-sm)] border border-border bg-card px-3 py-2 flex items-center justify-center min-h-[2.25rem]">
          <span className="font-mono text-sm font-medium text-foreground text-center break-all">
            {config.model}
          </span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="truncate">{config.provider_name}</span>
          <span className="font-mono shrink-0">
            {(config.context_window / 1000).toFixed(0)}k ·{" "}
            {(config.max_output_tokens / 1000).toFixed(0)}k out
          </span>
        </div>
        {(config.endpoints?.length ?? 0) > 1 && (
          <p className="text-[11px] text-muted-foreground">
            {t("arena.decode.endpointCount", { count: config.endpoints!.length })}
          </p>
        )}
      </div>

      {/* Parameter sliders: all share save-on-release */}
      <ParamSlider
        label="Temperature"
        hint={t("arena.decode.hintTemperature")}
        value={params.temperature}
        min={DECODE_FIELD_RANGES.temperature.min}
        max={DECODE_FIELD_RANGES.temperature.max}
        step={DECODE_FIELD_RANGES.temperature.step}
        format={(v) => v.toFixed(2)}
        onChange={(v) => updateParam("temperature", v)}
        onCommit={flushParams}
      />
      <ParamSlider
        label="Top P"
        hint={t("arena.decode.hintTopP")}
        value={params.top_p}
        min={DECODE_FIELD_RANGES.top_p.min}
        max={DECODE_FIELD_RANGES.top_p.max}
        step={DECODE_FIELD_RANGES.top_p.step}
        format={(v) => v.toFixed(2)}
        onChange={(v) => updateParam("top_p", v)}
        onCommit={flushParams}
      />
      <ParamSlider
        label="Frequency Penalty"
        hint={t("arena.decode.hintFrequencyPenalty")}
        value={params.frequency_penalty}
        min={DECODE_FIELD_RANGES.frequency_penalty.min}
        max={DECODE_FIELD_RANGES.frequency_penalty.max}
        step={DECODE_FIELD_RANGES.frequency_penalty.step}
        format={(v) => v.toFixed(1)}
        onChange={(v) => updateParam("frequency_penalty", v)}
        onCommit={flushParams}
      />
      <ParamSlider
        label="Presence Penalty"
        hint={t("arena.decode.hintPresencePenalty")}
        value={params.presence_penalty}
        min={DECODE_FIELD_RANGES.presence_penalty.min}
        max={DECODE_FIELD_RANGES.presence_penalty.max}
        step={DECODE_FIELD_RANGES.presence_penalty.step}
        format={(v) => v.toFixed(1)}
        onChange={(v) => updateParam("presence_penalty", v)}
        onCommit={flushParams}
      />

      {/* Max Tokens number input */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            Max Tokens
          </label>
          <span className="text-[11px] font-mono text-foreground">
            {params.max_tokens.toLocaleString()}
          </span>
        </div>
        <input
          type="range"
          min={DECODE_FIELD_RANGES.max_output_tokens.min}
          max={maxTokensSliderMax}
          step={DECODE_FIELD_RANGES.max_output_tokens.step}
          value={params.max_tokens}
          onChange={(e) =>
            updateParam(
              "max_tokens",
              clamp(parseInt(e.target.value, 10) || 0, DECODE_FIELD_RANGES.max_output_tokens.min, DECODE_FIELD_RANGES.max_output_tokens.max),
            )
          }
          onPointerUp={flushParams}
          onKeyUp={flushParams}
          aria-label="Max Tokens"
          className="w-full cursor-pointer"
        />
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>64</span>
          <span>{t("arena.decode.sliderCap", { cap: Math.round(maxTokensSliderMax / 1000) })}</span>
        </div>
      </div>

      {/* Estimated tokens */}
      <div className="rounded-[var(--radius-sm)] border border-border bg-muted/20 p-3 space-y-2">
        <button
          type="button"
          className="flex items-center gap-1.5 w-full text-left transition-colors hover:bg-muted/60"
          onClick={() => setShowEstimate(!showEstimate)}
          aria-expanded={showEstimate}
        >
          <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{t("arena.decode.estimateTitle")}</span>
          <span className="text-[11px] font-mono text-muted-foreground ml-auto">
            ~{estimatedTokens.toLocaleString()} tokens
          </span>
          <Info className="h-3 w-3 text-muted-foreground" />
        </button>

        <div
          className="soft-collapse"
          data-open={showEstimate ? "true" : undefined}
          aria-hidden={!showEstimate}
        >          <div className="soft-collapse-inner">
            <div className="text-[11px] text-muted-foreground space-y-1 pt-1 border-t border-border">
              <p>{t("arena.decode.estimateMethod")}</p>
              <p>
                {t("arena.decode.estimateFormula", {
                  per: promptTokensPerColumn,
                  count: columnCount,
                  total: estimatedTokens.toLocaleString(),
                })}
              </p>
              <p className="text-muted-foreground">{t("arena.decode.estimateNote")}</p>
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">{t("arena.decode.inputShare")}</span>
            <span className="font-mono">{inputPct}%</span>
          </div>
          <div className="token-bar">
            <div className="token-bar-fill" style={{ transform: `scaleX(${Math.max(0, Math.min(100, inputPct)) / 100})` }} />
          </div>
        </div>
      </div>

      {/* Dimension notes */}
      <div className="rounded-[var(--radius-sm)] border border-border bg-card/60 p-3">
        <p className="eyebrow mb-1.5">{t("arena.decode.currentDimension")}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

/** Shared slider component, avoiding repeated ParamSlider boilerplate across the 4 params. */
function ParamSlider({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
  onCommit,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  onCommit: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          {label}
        </label>
        <span className="text-[11px] font-mono text-foreground">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        aria-label={label}
        title={hint}
        className="w-full cursor-pointer"
      />
    </div>
  );
}
