/**
 * @file ConnectionsSection
 * @description Provider settings in a list-plus-detail layout (voyager pattern).
 *
 * Responsibilities:
 * - Render the connection rail (providers with status dots) and one detail pane
 * - Edit connection fields, model rows (per-model test/enable/delete), and the JSON config
 * - Own local test/json/editing state; every durable mutation flows through callbacks
 *
 * Presentational section: the page owns the form state and the save call.
 */

"use client";

import { useState } from "react";
import {
  Activity,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { UiSelect } from "@agentprism/ui";
import { DEFAULT_PROVIDER_NAME, safeHttpUrl, testProvider } from "@agentprism/client";
import { useT } from "@/i18n/useT";
import type { ConnectionGroup, ModelSlot } from "./settingsConnectionModel";
import { isLocalModelId, newLocalId } from "./settingsConnectionModel";
import { ModelCard } from "./ModelCard";
import { Field } from "./Field";

interface ConnectionsSectionProps {
  connections: ConnectionGroup[];
  modelCount: number;
  defaultEndpointId: string;
  selectedKey: string | null;
  saving: boolean;
  onSelect(key: string | null): void;
  onUpdateConn(key: string, patch: Partial<ConnectionGroup>): void;
  onUpdateModel(connKey: string, modelId: string, patch: Partial<ModelSlot>): void;
  onSetDefault(modelId: string): void;
  onDeleteModel(connKey: string, modelId: string): void;
  onDeleteConn(key: string): void;
  onAddModel(connKey: string): void;
  onAddProvider(): void;
  onSave(): void;
  onFlash(message: string): void;
}

interface TestOutcome {
  ok: boolean;
  message: string;
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/^https?:\/\//, "").slice(0, 36);
  }
}

function formatTokens(n?: number): string | null {
  if (!n || n <= 0) return null;
  if (n >= 1_000_000) return `${Math.round((n / 1_000_000) * 10) / 10}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function connectionLabel(c: ConnectionGroup): string {
  return c.provider_name.trim() || hostOf(c.base_url);
}

/** Provider settings section: rail + detail with connection fields, model rows, JSON config. */
export function ConnectionsSection({
  connections,
  modelCount,
  defaultEndpointId,
  selectedKey,
  saving,
  onSelect,
  onUpdateConn,
  onUpdateModel,
  onSetDefault,
  onDeleteModel,
  onDeleteConn,
  onAddModel,
  onAddProvider,
  onSave,
  onFlash,
}: ConnectionsSectionProps) {
  const t = useT();
  const [showKey, setShowKey] = useState(false);
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>({});
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, TestOutcome>>({});
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");

  const selected = connections.find((c) => c.key === selectedKey) ?? null;

  const testModel = async (c: ConnectionGroup, slot: ModelSlot): Promise<void> => {
    if (!slot.model.trim()) {
      onFlash(t("settings.toast.needModelIdBeforeTest"));
      return;
    }
    const resultKey = `${c.key}:${slot.id}`;
    setTestingKey(resultKey);
    try {
      const epId = isLocalModelId(slot.id) ? "" : slot.id;
      const res = await testProvider({
        test_endpoint_id: epId,
        endpoints: [
          {
            id: epId,
            label: slot.label,
            provider_name: c.provider_name,
            api_key: c.api_key,
            base_url: c.base_url,
            use_full_url: c.use_full_url,
            api_format: c.api_format,
            auth_field: c.auth_field,
            model: slot.model,
            context_window: slot.context_window,
            max_input_tokens: slot.max_input_tokens,
            max_output_tokens: slot.max_output_tokens,
            website_url: c.website_url,
            thinking_capable: slot.thinking_capable,
            thinking_level: slot.thinking_level,
            enabled: slot.enabled !== false,
          },
        ],
        api_key: c.api_key,
        base_url: c.base_url,
        api_format: c.api_format,
        auth_field: c.auth_field,
        model: slot.model,
        provider_name: c.provider_name,
        use_full_url: c.use_full_url,
      });
      setOutcomes((prev) => ({ ...prev, [resultKey]: { ok: res.ok, message: res.message } }));
      onFlash(
        res.ok
          ? t("settings.toast.testOk", { name: slot.model })
          : t("settings.toast.testFailed", { message: res.message }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOutcomes((prev) => ({ ...prev, [resultKey]: { ok: false, message } }));
      onFlash(t("settings.toast.testFailed", { message }));
    } finally {
      setTestingKey(null);
    }
  };

  const serializeGroup = (c: ConnectionGroup): string =>
    JSON.stringify(
      {
        provider_name: c.provider_name,
        base_url: c.base_url,
        api_format: c.api_format,
        auth_field: c.auth_field,
        use_full_url: c.use_full_url,
        website_url: c.website_url,
        // Empty string keeps the stored key (backend inherits by id/fingerprint).
        api_key: "",
        models: c.models.map((m) => ({
          label: m.label,
          model: m.model,
          enabled: m.enabled !== false,
          context_window: m.context_window,
          max_input_tokens: m.max_input_tokens,
          max_output_tokens: m.max_output_tokens,
          thinking_capable: m.thinking_capable,
          thinking_level: m.thinking_level,
          image_input: m.image_input,
          video_input: m.video_input,
        })),
      },
      null,
      2,
    );

  const applyGroupJson = (c: ConnectionGroup): void => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonDraft) as Record<string, unknown>;
    } catch {
      onFlash(t("settings.config.invalidJson"));
      return;
    }
    const str = (value: unknown, fallback: string): string =>
      typeof value === "string" && value.trim() !== "" ? value : fallback;
    const parsedModels = Array.isArray(parsed.models) ? (parsed.models as Record<string, unknown>[]) : null;
    const nextModels: ModelSlot[] =
      parsedModels === null
        ? c.models
        : parsedModels.map((m, index) => {
            const base = c.models[index] ?? { ...c.models[c.models.length - 1]!, id: newLocalId("m") };
            return {
              id: base.id,
              label: str(m.label, ""),
              model: str(m.model, base.model),
              context_window: typeof m.context_window === "number" ? m.context_window : base.context_window,
              max_input_tokens:
                typeof m.max_input_tokens === "number" ? m.max_input_tokens : base.max_input_tokens,
              max_output_tokens:
                typeof m.max_output_tokens === "number" ? m.max_output_tokens : base.max_output_tokens,
              thinking_capable: m.thinking_capable === true,
              thinking_level:
                m.thinking_level === "low" || m.thinking_level === "medium" || m.thinking_level === "high"
                  ? m.thinking_level
                  : "off",
              image_input: m.image_input === true,
              video_input: m.video_input === true,
              enabled: m.enabled !== false,
            };
          });
    onUpdateConn(c.key, {
      provider_name: str(parsed.provider_name, c.provider_name),
      base_url: str(parsed.base_url, c.base_url),
      api_format: parsed.api_format === "openai_chat" || parsed.api_format === "anthropic_messages" || parsed.api_format === "openai_responses"
        ? parsed.api_format
        : c.api_format,
      auth_field: str(parsed.auth_field, c.auth_field),
      use_full_url: parsed.use_full_url !== false,
      website_url: str(parsed.website_url, c.website_url),
      api_key: typeof parsed.api_key === "string" && parsed.api_key.trim() !== "" ? parsed.api_key : c.api_key,
      models: nextModels,
    });
    onFlash(t("settings.config.applied"));
    setJsonOpen(false);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[208px_minmax(0,1fr)] items-start gap-6">
      {/* provider rail */}
      <div
        className="flex md:flex-col gap-2 md:gap-2.5 md:border-r border-border/70 md:pr-4 self-stretch overflow-x-auto md:overflow-visible pb-1 md:pb-0"
        role="tablist"
        aria-label={t("settings.section.connections")}
      >
        <p className="hidden md:block eyebrow">
          {t("settings.rail.title")}
          <span className="ml-2 text-muted-foreground">{connections.length}</span>
        </p>
        {connections.map((c) => {
          const active = c.key === selectedKey;
          const hasKey = c.api_key_set === true || c.api_key.trim() !== "";
          const usable = hasKey && c.models.some((m) => m.enabled !== false);
          return (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(c.key)}
              className={
                "shrink-0 flex items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-sm transition-colors text-left " +
                (active
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-transparent hover:border-border hover:bg-muted/30")
              }
            >
              <span className="truncate max-w-[140px]">{connectionLabel(c)}</span>
              <span
                aria-hidden
                className={
                  "h-[7px] w-[7px] rounded-full shrink-0 " +
                  (usable ? "bg-success" : "border-[1.5px] border-muted-foreground/60")
                }
                title={usable ? t("settings.rail.ready") : t("settings.rail.notReady")}
              />
            </button>
          );
        })}
        <button
          type="button"
          className="shrink-0 flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
          onClick={onAddProvider}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("settings.rail.add")}
        </button>
      </div>

      {/* detail pane */}
      {selected === null ? (
        <div className="rounded-[var(--radius-sm)] border border-dashed border-border px-6 py-10 text-sm text-muted-foreground">
          {t("settings.rail.empty")}
        </div>
      ) : (
        <div className="min-w-0 space-y-5" key={selected.key}>
          {(() => {
            const c = selected;
            const hasKey = c.api_key_set === true || c.api_key.trim() !== "";
            return (
              <>
                {/* header */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold truncate">{connectionLabel(c)}</h2>
                    <p className="text-xs font-mono text-muted-foreground mt-1 truncate">
                      {c.api_format} · {hostOf(c.base_url)} ·{" "}
                      {hasKey ? t("settings.connection.keySet") : t("settings.connection.keyMissing")}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost !h-8 text-xs text-destructive"
                    onClick={() => {
                      onDeleteConn(c.key);
                      onSelect(null);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("settings.connection.deleteGroup")}
                  </button>
                </div>

                {/* regular */}
                <div className="rounded-[var(--radius-sm)] border border-border/70 p-4 space-y-3">
                  <p className="eyebrow">{t("settings.group.regular")}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <Field label={t("settings.connection.provider")}>
                      <input
                        className="form-input"
                        value={c.provider_name}
                        placeholder={`${DEFAULT_PROVIDER_NAME} / MiniMax / DeepSeek…`}
                        onChange={(e) => onUpdateConn(c.key, { provider_name: e.target.value })}
                      />
                    </Field>
                    <Field label={t("settings.connection.apiFormat")}>
                      <UiSelect
                        className="w-full"
                        value={c.api_format}
                        onChange={(value) => onUpdateConn(c.key, { api_format: value })}
                        ariaLabel={t("settings.connection.apiFormat")}
                        options={[
                          { value: "anthropic_messages", label: "Anthropic Messages" },
                          { value: "openai_chat", label: "OpenAI Chat" },
                          { value: "openai_responses", label: "OpenAI Responses" },
                        ]}
                      />
                    </Field>
                  </div>
                </div>

                {/* connection */}
                <div className="rounded-[var(--radius-sm)] border border-border/70 p-4 space-y-3">
                  <p className="eyebrow">{t("settings.group.connection")}</p>
                  <Field label={t("settings.connection.baseUrl")}>
                    <input
                      className="form-input font-mono text-sm"
                      value={c.base_url}
                      onChange={(e) => onUpdateConn(c.key, { base_url: e.target.value })}
                    />
                    <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={c.use_full_url}
                        onChange={(e) => onUpdateConn(c.key, { use_full_url: e.target.checked })}
                        className="accent-[var(--primary)]"
                      />
                      {t("settings.connection.fullUrl")}
                    </label>
                  </Field>
                  <Field label="API Key">
                    <div className="relative">
                      <input
                        className="form-input pr-12 font-mono text-sm"
                        type={showKey ? "text" : "password"}
                        placeholder={
                          c.api_key_set
                            ? t("settings.connection.keyPlaceholderSaved")
                            : t("settings.connection.keyPlaceholder")
                        }
                        value={c.api_key}
                        onChange={(e) => onUpdateConn(c.key, { api_key: e.target.value })}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setShowKey((s) => !s)}
                        aria-label={showKey ? t("settings.connection.hideKeyAria") : t("settings.connection.showKeyAria")}
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </Field>
                  <Field label={t("settings.connection.website")}>
                    <div className="flex gap-2">
                      <input
                        className="form-input"
                        value={c.website_url}
                        placeholder={t("settings.connection.optional")}
                        onChange={(e) => onUpdateConn(c.key, { website_url: e.target.value })}
                      />
                      <a
                        href={safeHttpUrl(c.website_url) ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-ghost shrink-0 !h-11 !w-11 !p-0"
                        aria-label={t("settings.connection.openWebsiteAria")}
                        onClick={(e) => {
                          if (!safeHttpUrl(c.website_url)) e.preventDefault();
                        }}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                  </Field>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      {t("settings.connection.advancedAuth")}
                    </summary>
                    <div className="mt-2">
                      <input
                        className="form-input font-mono text-sm"
                        value={c.auth_field}
                        onChange={(e) => onUpdateConn(c.key, { auth_field: e.target.value })}
                      />
                    </div>
                  </details>
                </div>

                {/* models */}
                <div className="rounded-[var(--radius-sm)] border border-border/70 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="eyebrow">{t("settings.group.models")}</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="btn-ghost !h-8 text-[11px]"
                        aria-pressed={c.models.every((m) => m.enabled !== false)}
                        onClick={() => {
                          const enable = !c.models.every((m) => m.enabled !== false);
                          onUpdateConn(c.key, {
                            models: c.models.map((m) => ({ ...m, enabled: enable })),
                          });
                        }}
                      >
                        {c.models.every((m) => m.enabled !== false)
                          ? t("settings.model.disableAll")
                          : t("settings.model.enableAll")}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost !h-8 !px-2 text-xs"
                        disabled={modelCount >= 12}
                        onClick={() => onAddModel(c.key)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {t("settings.connection.addModel")}
                      </button>
                    </div>
                  </div>

                  <ul className="space-y-1.5">
                    {c.models.map((m) => {
                      const enabled = m.enabled !== false;
                      const isDefault = m.id === defaultEndpointId;
                      const resultKey = `${c.key}:${m.id}`;
                      const outcome = outcomes[resultKey];
                      const testing = testingKey === resultKey;
                      const expanded = !!expandedModels[m.id];
                      const ctxBadge = formatTokens(m.context_window);
                      return (
                        <li
                          key={m.id}
                          className={
                            "rounded-[var(--radius-sm)] border " +
                            (enabled ? "border-border/80 bg-background/40" : "border-border/50 bg-muted/10")
                          }
                        >
                          <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                            <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                              <span
                                className={
                                  "text-sm font-medium truncate " +
                                  (enabled ? "" : "line-through text-muted-foreground")
                                }
                              >
                                {m.label || m.model || t("settings.model.unnamed")}
                              </span>
                              {isDefault && (
                                <Star className="h-3 w-3 fill-current text-primary" aria-label={t("settings.model.setDefaultTitle")} />
                              )}
                              <span className="font-mono text-[11px] text-muted-foreground truncate">{m.model}</span>
                              {m.thinking_capable && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border bg-muted/30">
                                  {t("settings.model.chipThinking")}
                                </span>
                              )}
                              {m.image_input && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border bg-muted/30">
                                  {t("settings.model.chipImage")}
                                </span>
                              )}
                              {m.video_input && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border bg-muted/30">
                                  {t("settings.model.chipVideo")}
                                </span>
                              )}
                              {ctxBadge && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border bg-muted/30 font-mono">
                                  {ctxBadge}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                className="btn-ghost !h-8 !px-2 text-xs"
                                disabled={testing || !hasKey}
                                title={hasKey ? undefined : t("settings.model.testNeedsKey")}
                                onClick={() => void testModel(c, m)}
                              >
                                {testing ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Activity className="h-3.5 w-3.5" />
                                )}
                                {t("settings.connection.test")}
                              </button>
                              <button
                                type="button"
                                className="btn-ghost !h-8 !w-8 !p-0"
                                aria-expanded={expanded}
                                aria-label={t("settings.model.editAria")}
                                onClick={() => setExpandedModels((s) => ({ ...s, [m.id]: !s[m.id] }))}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className="btn-ghost !h-8 !w-8 !p-0"
                                disabled={c.models.length <= 1}
                                onClick={() => onDeleteModel(c.key, m.id)}
                                aria-label={t("settings.model.deleteAria")}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={enabled}
                                aria-label={t("settings.model.enableAria")}
                                className={
                                  "relative h-5 w-9 rounded-full transition-colors " +
                                  (enabled ? "bg-primary" : "bg-muted-foreground/40")
                                }
                                onClick={() => onUpdateModel(c.key, m.id, { enabled: !enabled })}
                              >
                                <span
                                  className={
                                    "absolute top-0.5 h-4 w-4 rounded-full bg-background transition-all " +
                                    (enabled ? "left-[18px]" : "left-0.5")
                                  }
                                />
                              </button>
                            </div>
                          </div>
                          {outcome && (
                            <p
                              role="status"
                              className={
                                "px-3 pb-2 text-xs " + (outcome.ok ? "text-success" : "text-destructive")
                              }
                            >
                              {outcome.ok ? "✓ " : "✕ "}
                              {outcome.message}
                            </p>
                          )}
                          {expanded && (
                            <div className="border-t border-border/60 px-3 py-3">
                              <ModelCard
                                model={m}
                                index={c.models.indexOf(m)}
                                isDefault={isDefault}
                                expanded
                                onToggleExpand={() => setExpandedModels((s) => ({ ...s, [m.id]: false }))}
                                onUpdate={(patch) => onUpdateModel(c.key, m.id, patch)}
                                onSetDefault={() => onSetDefault(m.id)}
                                onDelete={() => onDeleteModel(c.key, m.id)}
                                canDelete={c.models.length > 1}
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {t("settings.connection.modelsHint")}
                  </p>
                </div>

                {/* config file */}
                <div className="rounded-[var(--radius-sm)] border border-border/70 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="eyebrow">{t("settings.group.config")}</p>
                    <button
                      type="button"
                      className="btn-ghost !h-8 text-xs"
                      onClick={() => {
                        setJsonOpen((open) => !open);
                        setJsonDraft(serializeGroup(selected));
                      }}
                    >
                      {jsonOpen ? t("settings.config.cancel") : t("settings.config.edit")}
                    </button>
                  </div>
                  {jsonOpen && (
                    <div className="space-y-2">
                      <textarea
                        className="form-input font-mono text-xs min-h-[220px]"
                        value={jsonDraft}
                        onChange={(e) => setJsonDraft(e.target.value)}
                        spellCheck={false}
                      />
                      <p className="text-[11px] text-muted-foreground">{t("settings.config.hint")}</p>
                      <div className="flex gap-2">
                        <button type="button" className="btn-primary !h-9 text-xs" onClick={() => applyGroupJson(c)}>
                          {t("settings.config.apply")}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost !h-9 text-xs"
                          onClick={() => setJsonOpen(false)}
                        >
                          {t("settings.config.cancel")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" className="btn-primary" disabled={saving} onClick={onSave}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {t("settings.page.save")}
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
