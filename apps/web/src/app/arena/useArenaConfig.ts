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
import { customFieldDimension, dimensionFieldName, fetchArenaMeta, fetchTemplates } from "@agentprism/client";
import type {
  ArenaMeta,
  BaselineOverrides,
  DimensionId,
  TaskTemplate,
} from "@agentprism/client";
import { DIMENSION_IDS, effectiveThinkingMode, type BaselineDraft } from "./arenaConstants";
import { templateQuestion } from "./templateLabels";
import { useT } from "@/i18n/useT";

/** localStorage key for the user's last baseline (preference persistence). */
const BASELINE_STORAGE_KEY = "agentprism.arena.baseline.v1";

/** Reads the stored baseline overlay; null when absent or corrupted (values are re-guarded at use). */
function loadStoredBaseline(): BaselineDraft | null {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(BASELINE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as BaselineDraft;
  } catch {
    return null;
  }
}

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
  const [baseline, setBaseline] = useState<BaselineDraft>({});
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
          setBaseline({ ...m.baseline_defaults, ...loadStoredBaseline() });
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
    return () => { ac.abort(); };
  }, [setError, t]);

  // Preference persistence: every settled baseline change writes through to
  // localStorage, so the next visit starts from the user's last configuration.
  useEffect(() => {
    if (metaLoading) return;
    try {
      window.localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baseline));
    } catch {
      // Private mode / quota: preferences simply reset next visit.
    }
  }, [baseline, metaLoading]);

  /** Clears the stored preference and restores the server-served baseline defaults. */
  const resetBaseline = useCallback(() => {
    try {
      window.localStorage.removeItem(BASELINE_STORAGE_KEY);
    } catch {
      // Storage unavailable: the in-memory reset below still applies.
    }
    setBaseline({ ...(meta?.baseline_defaults ?? {}) });
  }, [meta]);

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
  const servedDimensions = meta?.dimensions;
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
    // Accept a shared link's axis whenever the server serves it: builtins plus
    // registered custom dimensions. Unknown ids still fall back to the default.
    if (dim && (DIMENSION_IDS as readonly string[]).includes(dim)) {
      setDimension(dim as DimensionId);
    } else if (dim && servedDimensions?.some((entry) => entry.id === dim)) {
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
  }, [searchParams, metaLoading, templates, templatesLoaded, applyTemplate, servedDimensions]);

  const baselinePayload = useMemo(() => {
    // The compared dimension's own field is pinned by the axis, not the baseline:
    // the server-served field when /meta lists the dimension, else the contracts
    // mapping (builtin id → its config field, anything else → `custom.<id>`).
    const activeField =
      meta?.dimensions.find((entry) => entry.id === dimension)?.options[0]?.field ??
      dimensionFieldName(dimension);
    const allowed = new Set(
      (meta?.baseline_fields ?? []).map((f) => f.field).filter(Boolean),
    );
    // Mutually exclusive thinking modes: only the active mode's intensity field
    // travels on the wire — the inactive side's stale value must never reach the
    // server, where it would fail the mode legality check. The mode itself is
    // normalized against the served options: a stored draft from an endpoint
    // that no longer offers budget pairs falls back to level mapping.
    const thinkingMode = effectiveThinkingMode(meta, baseline);
    const out: BaselineOverrides = {};
    const custom: Record<string, string> = {};
    Object.keys(baseline).forEach((key) => {
      if (key === activeField || key === "model_id") return;
      if (allowed.size > 0 && !allowed.has(key)) return;
      if (key === "thinking_budget" && thinkingMode !== "budget") return;
      if (key === "thinking_level" && thinkingMode === "budget") return;
      if (key === "thinking_mode") {
        // Ship the normalized mode: a stale draft value the server no longer
        // offers must not travel on the wire (the backend now rejects it).
        Object.assign(out, { [key]: thinkingMode });
        return;
      }
      const val: unknown = baseline[key];
      // Stored preferences are untrusted JSON: re-guard the value, not just its type.
      if (typeof val !== "string" || val === "") return;
      // Custom dimensions travel as one nested record (the wire shape); the panel
      // keys them flat as `custom.<id>`.
      const customId = customFieldDimension(key);
      if (customId !== "") {
        custom[customId] = val;
        return;
      }
      Object.assign(out, { [key]: val });
    });
    if (Object.keys(custom).length > 0) out.custom = custom;
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
    resetBaseline,
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
