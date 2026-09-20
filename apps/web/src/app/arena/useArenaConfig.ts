/**
 * @file useArenaConfig
 * @description Arena page run configuration state.
 *
 * Responsibilities:
 * - Load meta and templates
 * - Hold question, dimension, selection, and baseline state
 * - Support URL prefill and derive the baseline payload
 */

"use client";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchArenaMeta, fetchTemplates } from "@agentprism/client";
import type {
  ArenaMeta,
  BaselineOverrides,
  DimensionId,
  TaskTemplate,
} from "@agentprism/client";
import { DIMENSION_FIELD, DIMENSION_IDS } from "./arenaConstants";
import { templateQuestion } from "./templateLabels";
import { useT } from "@/i18n/useT";

/**
 * Loads Arena metadata once and derives dimension/selection state.
 *
 * @param setError Error banner writer.
 */
export function useArenaConfig(setError: (msg: string | null) => void) {
  const t = useT();
  const searchParams = useSearchParams();
  const [meta, setMeta] = useState<ArenaMeta | null>(null);
  /** Current question: a run setting alongside dimension/selections/baseline, owned by this hook */
  const [question, setQuestion] = useState("");
  const [dimension, setDimension] = useState<DimensionId>("framework");
  /**
   * Explicit column selections: null = untouched (show all options as implicit selection);
   * [] = explicitly cleared (empty state, run disabled). Distinguishing null from []
   * is what allows "zero selections allowed" without breaking the initial show-all UX.
   */
  const [selections, setSelections] = useState<string[] | null>(null);
  const [baseline, setBaseline] = useState<BaselineOverrides>({});
  const [metaLoading, setMetaLoading] = useState(true);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  /** Template list has settled (success or failure): distinguishes "loading, must wait" from "loaded but empty, may degrade" */
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchArenaMeta({ signal: ac.signal })
      .then((m) => {
        setMeta(m);
        if (m.baseline_defaults) {
          setBaseline({ ...m.baseline_defaults } as BaselineOverrides);
        }
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          setError(t("arena.config.loadFailed", { message: err.message }));
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setMetaLoading(false);
      });
    return () => ac.abort();
  }, [setError, t]);

  useEffect(() => {
    const ac = new AbortController();
    fetchTemplates({ signal: ac.signal })
      .then((list) => {
        setTemplates(list);
        setTemplatesLoaded(true);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          console.error("Failed to load task templates:", err);
        }
        // Failure must still allow URL prefill; otherwise a failed ?template= request would permanently skip all prefill params of the same URL
        setTemplatesLoaded(true);
      });
    return () => ac.abort();
  }, []);

  const applyTemplate = useCallback(
    (tpl: TaskTemplate) => {
      // Localized overlay: the suggestion list shows the translated question, so the
      // applied text must match what the user clicked, not the English canonical.
      setQuestion(templateQuestion(t, tpl.id, tpl.question));
      setActiveTemplateId(tpl.id);
      if (tpl.suggested_dimension) {
        setDimension(tpl.suggested_dimension);
      }
      if (tpl.suggested_selections.length >= 1) {
        setSelections([...tpl.suggested_selections]);
      }
      setError(null);
    },
    [setError, t],
  );

  const urlPrefilledRef = useRef(false);
  useEffect(() => {
    if (urlPrefilledRef.current || metaLoading) return;
    const tid = searchParams.get("template");
    if (tid && !templatesLoaded) return;
    urlPrefilledRef.current = true;
    const t = tid ? templates.find((x) => x.id === tid) : undefined;
    if (t) {
      applyTemplate(t);
      return;
    }
    const q = searchParams.get("q");
    if (q) setQuestion(q);
    const dim = searchParams.get("dimension");
    if (dim && (DIMENSION_IDS as readonly string[]).includes(dim)) {
      setDimension(dim as DimensionId);
    }
    const sel = searchParams.get("selections");
    if (sel !== null) {
      setSelections(
        sel
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    }
  }, [searchParams, metaLoading, templates, templatesLoaded, applyTemplate]);

  const baselinePayload = useMemo(() => {
    const locked = DIMENSION_FIELD[dimension];
    const allowed = new Set(
      (meta?.baseline_fields ?? []).map((f) => f.field).filter(Boolean),
    );
    const out: BaselineOverrides = {};
    (Object.keys(baseline) as Array<keyof BaselineOverrides>).forEach((key) => {
      if (key === locked || key === "model_id") return;
      if (allowed.size > 0 && !allowed.has(key)) return;
      const val = baseline[key];
      if (typeof val === "string" && val) {
        Object.assign(out, { [key]: val });
      }
    });
    return out;
  }, [baseline, dimension, meta]);

  const activeDim = useMemo(
    () => meta?.dimensions.find((d) => d.id === dimension) ?? null,
    [meta, dimension],
  );

  const activeSelections = useMemo(
    () => (selections ?? activeDim?.options.map((o) => o.value) ?? []),
    [selections, activeDim],
  );

  const columnCount = activeSelections.length;

  const placeholderLabels = useMemo(() => {
    if (activeDim) {
      return activeDim.options
        .filter((o) => activeSelections.includes(o.value))
        .map((o) => o.label);
    }
    return [];
  }, [activeDim, activeSelections]);

  const toggleSelection = useCallback(
    (value: string) => {
      setSelections((prev) => {
        const base = prev ?? activeDim?.options.map((o) => o.value) ?? [];
        const next = base.includes(value) ? base.filter((v) => v !== value) : [...base, value];
        return next;
      });
    },
    [activeDim],
  );

  const resetDimensionState = useCallback(() => {
    setSelections(null);
    setActiveTemplateId(null);
  }, []);

  return {
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
  };
}
