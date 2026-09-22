/**
 * @file settings/page
 * @description The /settings route page.
 *
 * Responsibilities:
 * - Own the provider connection/model form state and the save call
 * - Render the sectioned layout (connections / decode / runtime / memory)
 *
 * The page holds form state; sections are presentational and mutate through
 * callbacks. Connections and decode save through one PUT (saveProvider).
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Cable, Gauge, Loader2, Plug, SlidersHorizontal, Sparkles } from "lucide-react";
import { ProviderConfig, fetchProvider, saveProvider } from "@agentprism/client";
import { useT } from "@/i18n/useT";
import {
  type ConnectionGroup,
  type ModelSlot,
  type SettingsForm,
  blankConnection,
  flattenConnections,
  groupEndpoints,
  isLocalModelId,
  newLocalId,
} from "./settingsConnectionModel";
import { ConnectionsSection } from "./ConnectionsSection";
import { McpSection } from "./McpSection";
import { SkillsSection } from "./SkillsSection";
import { DecodeDefaultsSection } from "./DecodeDefaultsSection";
import { MemorySection } from "./MemorySection";
import { RuntimeKnobsSection } from "./RuntimeKnobsSection";

type SectionId = "connections" | "decode" | "runtime" | "memory" | "skills" | "mcp";

/** Settings route: sectioned provider/runtime/memory configuration. */
export default function SettingsPage() {
  const t = useT();
  const [section, setSection] = useState<SectionId>("connections");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedConnKey, setSelectedConnKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<SettingsForm>({
    notes: "",
    connections: [blankConnection()],
    default_endpoint_id: "",
    temperature: 0,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_output_tokens: 2048,
  });
  const abortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    fetchProvider({ signal: ac.signal })
      .then((cfg: ProviderConfig) => {
        const connections = groupEndpoints(cfg);
        setForm({
          notes: cfg.notes ?? "",
          connections,
          default_endpoint_id: cfg.default_endpoint_id || connections[0]?.models[0]?.id || "",
          temperature: cfg.temperature ?? 0,
          top_p: cfg.top_p ?? 1,
          frequency_penalty: cfg.frequency_penalty ?? 0,
          presence_penalty: cfg.presence_penalty ?? 0,
          max_output_tokens: cfg.max_output_tokens ?? 2048,
        });
        setSelectedConnKey(connections[0]?.key ?? null);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setLoadError(err.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, []);

  const flash = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const updateConn = (key: string, patch: Partial<ConnectionGroup>) => {
    setForm((f) => ({
      ...f,
      connections: f.connections.map((c) => (c.key === key ? { ...c, ...patch } : c)),
    }));
  };

  const updateModel = (connKeyStr: string, modelId: string, patch: Partial<ModelSlot>) => {
    setForm((f) => ({
      ...f,
      connections: f.connections.map((c) => {
        if (c.key !== connKeyStr) return c;
        return {
          ...c,
          models: c.models.map((m) => (m.id === modelId ? { ...m, ...patch } : m)),
        };
      }),
    }));
  };

  const modelCount = form.connections.reduce((n, c) => n + c.models.length, 0);

  const submit = async (): Promise<void> => {
    const endpoints = flattenConnections(form.connections);
    if (endpoints.length < 1) {
      flash(t("settings.toast.needModelId"));
      return;
    }
    setSaving(true);
    try {
      const defId = form.default_endpoint_id;
      const saved = await saveProvider({
        notes: form.notes,
        website_url:
          form.connections.find((c) => c.models.some((m) => m.id === defId))?.website_url ||
          form.connections[0]?.website_url ||
          "",
        default_endpoint_id: isLocalModelId(defId) ? "" : defId,
        temperature: form.temperature,
        top_p: form.top_p,
        frequency_penalty: form.frequency_penalty,
        presence_penalty: form.presence_penalty,
        max_output_tokens: form.max_output_tokens,
        endpoints,
      });
      const connections = groupEndpoints(saved);
      setForm((f) => ({
        ...f,
        notes: saved.notes ?? f.notes,
        connections,
        default_endpoint_id: saved.default_endpoint_id || connections[0]?.models[0]?.id || "",
        temperature: saved.temperature,
        top_p: saved.top_p,
        frequency_penalty: saved.frequency_penalty,
        presence_penalty: saved.presence_penalty,
        max_output_tokens: saved.max_output_tokens,
      }));
      setSelectedConnKey((key) => connections.find((c) => c.key === key)?.key ?? connections[0]?.key ?? null);
      flash(t("settings.toast.saved"));
    } catch (err) {
      flash(err instanceof Error ? err.message : t("settings.toast.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const sections: ReadonlyArray<{ id: SectionId; label: string; icon: typeof Cable }> = [
    { id: "connections", label: t("settings.section.connections"), icon: Cable },
    { id: "decode", label: t("settings.section.decode"), icon: SlidersHorizontal },
    { id: "runtime", label: t("settings.section.runtime"), icon: Gauge },
    { id: "memory", label: t("settings.section.memory"), icon: Brain },
    { id: "skills", label: t("settings.section.skills"), icon: Sparkles },
    { id: "mcp", label: t("settings.section.mcp"), icon: Plug },
  ];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
        <div className="loading-prism" aria-hidden />
        <p className="text-sm">{t("settings.page.loading")}</p>
        {loadError && <p className="text-xs text-destructive">{loadError}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 fade-in">
      <div>
        <p className="eyebrow mb-2">BYOK</p>
        <h1 className="page-title text-3xl">{t("settings.page.title")}</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[176px_minmax(0,1fr)] items-start gap-6">
        <nav
          aria-label={t("settings.section.navAria")}
          className="flex md:flex-col gap-1.5 overflow-x-auto md:overflow-visible pb-1 md:pb-0 md:border-r border-border/70 md:pr-3 self-stretch"
        >
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? "true" : undefined}
              onClick={() => setSection(id)}
              className={
                "shrink-0 flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm text-left transition-colors " +
                (section === id
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/30")
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="whitespace-nowrap md:whitespace-normal">{label}</span>
            </button>
          ))}
        </nav>

        <div className="min-w-0 space-y-5">
          {section === "connections" && (
            <>
              {modelCount < 2 && (
                <p className="text-xs text-warning">{t("settings.page.tooFewModels")}</p>
              )}
              <ConnectionsSection
                connections={form.connections}
                modelCount={modelCount}
                defaultEndpointId={form.default_endpoint_id}
                selectedKey={selectedConnKey}
                saving={saving}
                onSelect={setSelectedConnKey}
                onUpdateConn={updateConn}
                onUpdateModel={updateModel}
                onSetDefault={(modelId) => setForm((f) => ({ ...f, default_endpoint_id: modelId }))}
                onDeleteModel={(connKey, modelId) => {
                  setForm((f) => {
                    const target = f.connections.find((c) => c.key === connKey);
                    if (target === undefined) return f;
                    const nextModels = target.models.filter((x) => x.id !== modelId);
                    let def = f.default_endpoint_id;
                    if (def === modelId) def = nextModels[0]?.id || "";
                    return {
                      ...f,
                      default_endpoint_id: def,
                      connections: f.connections.map((x) =>
                        x.key === connKey ? { ...x, models: nextModels } : x,
                      ),
                    };
                  });
                }}
                onDeleteConn={(key) => {
                  setForm((f) => {
                    const removed = f.connections.find((c) => c.key === key);
                    const next = f.connections.filter((x) => x.key !== key);
                    let def = f.default_endpoint_id;
                    if (removed?.models.some((m) => m.id === def)) {
                      def = next[0]?.models[0]?.id || "";
                    }
                    return { ...f, connections: next, default_endpoint_id: def };
                  });
                  setSelectedConnKey(null);
                }}
                onAddModel={(connKey, draft) => {
                  const c = form.connections.find((x) => x.key === connKey);
                  if (c === undefined || modelCount >= 12) return;
                  updateConn(connKey, { models: [...c.models, { ...draft, id: newLocalId("m") }] });
                }}
                onAddProvider={() => {
                  const c = blankConnection();
                  setForm((f) => ({
                    ...f,
                    connections: [...f.connections, c],
                    default_endpoint_id: f.default_endpoint_id || c.models[0]?.id || "",
                  }));
                  setSelectedConnKey(c.key);
                }}
                onSave={() => void submit()}
                onFlash={flash}
              />
            </>
          )}

          {section === "decode" && (
            <div className="panel-surface settings-panel p-6 space-y-5">
              <DecodeDefaultsSection
                form={form}
                onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
              />
              <button type="button" className="btn-primary" disabled={saving} onClick={() => void submit()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("settings.page.save")}
              </button>
            </div>
          )}

          {section === "runtime" && <RuntimeKnobsSection onFlash={flash} />}
          {section === "memory" && <MemorySection onFlash={flash} />}
          {section === "skills" && <SkillsSection onFlash={flash} />}
          {section === "mcp" && <McpSection onFlash={flash} />}
        </div>
      </div>

      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-6 right-6 panel-surface px-4 py-3 text-sm z-50 fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}
