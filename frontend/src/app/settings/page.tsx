"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Star,
  Trash2,
  Zap,
} from "lucide-react";
import { ProviderConfig, fetchProvider, saveProvider, testProvider } from "@/lib/api";
import { safeHttpUrl } from "@/lib/safeUrl";

/** 同一连接下的单个模型槽位（对应后端一条 LlmEndpoint） */
type ModelSlot = {
  id: string;
  label: string;
  model: string;
  context_window: number;
  max_input_tokens: number;
  max_output_tokens: number;
  thinking_capable: boolean;
  thinking_level: string;
};

/** 固定 URL/Key/格式的连接组，可挂多个模型 */
type ConnectionGroup = {
  key: string;
  provider_name: string;
  website_url: string;
  api_key: string;
  api_key_set?: boolean;
  base_url: string;
  use_full_url: boolean;
  api_format: string;
  auth_field: string;
  models: ModelSlot[];
};

type SettingsForm = {
  notes: string;
  connections: ConnectionGroup[];
  default_endpoint_id: string;
  temperature: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  max_output_tokens: number;
};

function newLocalId(prefix = "new"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function connKey(baseUrl: string, apiFormat: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "").toLowerCase()}::${apiFormat}`;
}

function blankModel(): ModelSlot {
  return {
    id: newLocalId("m"),
    label: "",
    model: "",
    context_window: 128000,
    max_input_tokens: 120000,
    max_output_tokens: 2048,
    thinking_capable: false,
    thinking_level: "off",
  };
}

function blankConnection(): ConnectionGroup {
  return {
    key: newLocalId("c"),
    provider_name: "",
    website_url: "",
    api_key: "",
    base_url: "https://api.example.com/v1",
    use_full_url: true,
    api_format: "openai_chat",
    auth_field: "Authorization",
    models: [blankModel()],
  };
}

/** 将扁平 endpoints 按 (base_url, api_format) 聚合成连接组 */
function groupEndpoints(cfg: ProviderConfig): ConnectionGroup[] {
  const list = cfg.endpoints ?? [];
  if (list.length === 0) {
    const c = blankConnection();
    c.provider_name = cfg.provider_name || "";
    c.base_url = cfg.base_url;
    c.use_full_url = cfg.use_full_url;
    c.api_format = cfg.api_format;
    c.auth_field = cfg.auth_field;
    c.website_url = cfg.website_url || "";
    c.api_key_set = cfg.api_key_set;
    c.models = [
      {
        id: "legacy",
        label: "",
        model: cfg.model,
        context_window: cfg.context_window,
        max_input_tokens: cfg.max_input_tokens,
        max_output_tokens: cfg.max_output_tokens,
        thinking_capable: false,
        thinking_level: "off",
      },
    ];
    return [c];
  }

  const order: string[] = [];
  const map = new Map<string, ConnectionGroup>();
  for (const ep of list) {
    const k = connKey(ep.base_url, ep.api_format);
    let g = map.get(k);
    if (!g) {
      g = {
        key: k,
        provider_name: ep.provider_name ?? "",
        website_url: ep.website_url || cfg.website_url || "",
        api_key: "",
        api_key_set: ep.api_key_set,
        base_url: ep.base_url,
        use_full_url: ep.use_full_url ?? true,
        api_format: ep.api_format,
        auth_field: ep.auth_field,
        models: [],
      };
      map.set(k, g);
      order.push(k);
    } else if (ep.api_key_set) {
      g.api_key_set = true;
    }
    if (!g.website_url && ep.website_url) g.website_url = ep.website_url;
    if (!g.provider_name && ep.provider_name) g.provider_name = ep.provider_name;
    g.models.push({
      id: ep.id,
      label: ep.label ?? "",
      model: ep.model,
      context_window: ep.context_window ?? 128000,
      max_input_tokens: ep.max_input_tokens ?? 120000,
      max_output_tokens: ep.max_output_tokens ?? 2048,
      thinking_capable: !!ep.thinking_capable,
      thinking_level: ep.thinking_level || "off",
    });
  }
  return order.map((k) => map.get(k)!);
}

function flattenConnections(connections: ConnectionGroup[]) {
  const endpoints: Record<string, unknown>[] = [];
  for (const c of connections) {
    for (const m of c.models) {
      if (!m.model.trim()) continue;
      endpoints.push({
        id: m.id.startsWith("m_") || m.id.startsWith("new_") ? "" : m.id,
        label: m.label,
        provider_name: c.provider_name,
        api_key: c.api_key,
        base_url: c.base_url,
        use_full_url: c.use_full_url,
        api_format: c.api_format,
        auth_field: c.auth_field,
        model: m.model.trim(),
        context_window: m.context_window,
        max_input_tokens: m.max_input_tokens,
        max_output_tokens: m.max_output_tokens,
        website_url: c.website_url,
        thinking_capable: m.thinking_capable,
        thinking_level: m.thinking_capable ? m.thinking_level : "off",
      });
    }
  }
  return endpoints;
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  /** 模型详情展开：默认收起，只显示名称 + model id */
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  /** 按接入点 key 存放测连结果，显示在对应卡片内 */
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});

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
  const [loadError, setLoadError] = useState<string | null>(null);

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

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const endpoints = flattenConnections(form.connections);
    if (endpoints.length < 1) {
      flash("请至少配置一个带 model id 的模型");
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
        default_endpoint_id: defId.startsWith("m_") || defId.startsWith("new_") ? "" : defId,
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
        max_output_tokens: saved.max_output_tokens,
      }));
      flash("Provider 配置已保存");
    } catch (err) {
      flash(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const onTestConn = async (c: ConnectionGroup, modelId?: string) => {
    const slot = c.models.find((m) => m.id === modelId) || c.models[0];
    if (!slot?.model.trim()) {
      flash("请先填写 model id 再测连");
      return;
    }
    setTestingKey(`${c.key}:${slot.id}`);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[c.key];
      return next;
    });
    try {
      const epId = slot.id.startsWith("m_") || slot.id.startsWith("new_") ? "" : slot.id;
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
      setTestResults((prev) => ({ ...prev, [c.key]: res }));
      flash(res.ok ? `测连成功：${slot.model || c.provider_name || "接入点"}` : `测连失败：${res.message}`);
    } finally {
      setTestingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
        <div className="loading-prism" aria-hidden />
        <p className="text-sm">加载配置…</p>
        {loadError && <p className="text-xs text-destructive">{loadError}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 fade-in">
      <div>
        <p className="eyebrow mb-2">BYOK</p>
        <h1 className="page-title text-3xl">Provider 配置</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-xl leading-relaxed">
          每个接入点固定请求地址与 API Key；其下可挂多个 model（显示名 / 上下文 /
          最大输出）。跨厂请新建接入点。解码参数在 Arena 基线统一设置。
        </p>
      </div>

      <form onSubmit={onSubmit} className="panel-surface p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow">LLM 接入点</p>
          <button
            type="button"
            className="btn-ghost !h-9 text-xs"
            disabled={modelCount >= 12}
            onClick={() => {
              const c = blankConnection();
              setForm((f) => ({
                ...f,
                connections: [...f.connections, c],
                default_endpoint_id: f.default_endpoint_id || c.models[0]?.id || "",
              }));
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            新建接入点
          </button>
        </div>

        {form.connections.map((c, ci) => {
          const showKey = !!showKeys[c.key];
          const hasDefault = c.models.some((m) => m.id === form.default_endpoint_id);
          return (
            <div
              key={c.key}
              className={
                "rounded-[var(--radius-sm)] border p-4 space-y-4 " +
                (hasDefault ? "border-primary/50 bg-primary/5" : "border-border bg-muted/15")
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  接入点 {ci + 1}
                  {c.provider_name ? (
                    <span className="ml-2 text-muted-foreground font-normal">{c.provider_name}</span>
                  ) : null}
                  {hasDefault && (
                    <span className="ml-2 text-[10px] text-primary font-mono">含默认模型</span>
                  )}
                </p>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    className="btn-ghost !h-8 !px-2 text-xs"
                    disabled={!!testingKey}
                    onClick={() => onTestConn(c)}
                  >
                    {testingKey?.startsWith(c.key) ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Zap className="h-3.5 w-3.5" />
                    )}
                    测连
                  </button>
                  <button
                    type="button"
                    className="btn-ghost !h-8 !w-8 !p-0"
                    disabled={form.connections.length <= 1}
                    onClick={() => {
                      setForm((f) => {
                        const next = f.connections.filter((x) => x.key !== c.key);
                        let def = f.default_endpoint_id;
                        if (c.models.some((m) => m.id === def)) {
                          def = next[0]?.models[0]?.id || "";
                        }
                        return { ...f, connections: next, default_endpoint_id: def };
                      });
                    }}
                    aria-label="删除接入点"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {(() => {
                const tr = testResults[c.key];
                if (!tr) return null;
                return (
                  <div
                    role="status"
                    className={
                      "rounded-[var(--radius-sm)] border px-3 py-2 text-xs leading-relaxed " +
                      (tr.ok
                        ? "border-success/35 bg-success/10 text-foreground"
                        : "border-destructive/40 bg-destructive/10 text-destructive")
                    }
                  >
                    {tr.message}
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <Field label="供应商">
                  <input
                    className="form-input"
                    value={c.provider_name}
                    placeholder="StepFun / MiniMax / DeepSeek…"
                    onChange={(e) => updateConn(c.key, { provider_name: e.target.value })}
                  />
                </Field>
                <Field label="API 格式">
                  <select
                    className="form-input"
                    value={c.api_format}
                    onChange={(e) => updateConn(c.key, { api_format: e.target.value })}
                  >
                    <option value="anthropic_messages">Anthropic Messages</option>
                    <option value="openai_chat">OpenAI Chat</option>
                  </select>
                </Field>
              </div>

              <Field label="请求地址">
                <input
                  className="form-input font-mono text-sm"
                  value={c.base_url}
                  required
                  onChange={(e) => updateConn(c.key, { base_url: e.target.value })}
                />
                <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={c.use_full_url}
                    onChange={(e) => updateConn(c.key, { use_full_url: e.target.checked })}
                    className="accent-[var(--primary)]"
                  />
                  完整 URL
                </label>
              </Field>

              <Field label="API Key">
                <div className="relative">
                  <input
                    className="form-input pr-12 font-mono text-sm"
                    type={showKey ? "text" : "password"}
                    placeholder={c.api_key_set ? "已保存（留空保持）" : "填写 API Key"}
                    value={c.api_key}
                    onChange={(e) => updateConn(c.key, { api_key: e.target.value })}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowKeys((s) => ({ ...s, [c.key]: !s[c.key] }))}
                    aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>

              <Field label="官网链接（本接入点参考）">
                <div className="flex gap-2">
                  <input
                    className="form-input"
                    value={c.website_url}
                    placeholder="可选"
                    onChange={(e) => updateConn(c.key, { website_url: e.target.value })}
                  />
                  <a
                    href={safeHttpUrl(c.website_url) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-ghost shrink-0 !h-11 !w-11 !p-0"
                    aria-label="打开官网"
                    onClick={(e) => {
                      if (!safeHttpUrl(c.website_url)) e.preventDefault();
                    }}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </Field>

              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">高级：认证字段</summary>
                <div className="mt-2">
                  <input
                    className="form-input font-mono text-sm"
                    value={c.auth_field}
                    onChange={(e) => updateConn(c.key, { auth_field: e.target.value })}
                  />
                </div>
              </details>

              <div className="spectrum-line-soft" aria-hidden />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground">模型列表</p>
                <button
                  type="button"
                  className="btn-ghost !h-8 !px-2 text-xs"
                  disabled={modelCount >= 12}
                  onClick={() => {
                    const m = blankModel();
                    updateConn(c.key, { models: [...c.models, m] });
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  添加模型
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                默认收起只显示名称与 model id。展开可配置上下文、思考能力与强度。Arena
                「思考强度」维可对比档位；未勾选「支持思考」的模型会强制关闭思考。
              </p>

              <ul className="space-y-2">
                {c.models.map((m, mi) => {
                  const isDef = form.default_endpoint_id === m.id;
                  const open = !!expandedModels[m.id];
                  const levelLab =
                    m.thinking_level === "low"
                      ? "低"
                      : m.thinking_level === "medium"
                        ? "中"
                        : m.thinking_level === "high"
                          ? "高"
                          : "关";
                  return (
                    <li
                      key={m.id}
                      className={
                        "rounded-[var(--radius-sm)] border " +
                        (isDef ? "border-primary/40 bg-background/60" : "border-border/80 bg-background/40")
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <button
                          type="button"
                          className="btn-ghost !h-7 !w-7 !p-0 shrink-0"
                          aria-expanded={open}
                          aria-label={open ? "收起模型详情" : "展开模型详情"}
                          onClick={() =>
                            setExpandedModels((s) => ({ ...s, [m.id]: !s[m.id] }))
                          }
                        >
                          {open ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            className="form-input !h-8 text-sm"
                            value={m.label}
                            placeholder="显示名称"
                            aria-label={`模型 ${mi + 1} 显示名称`}
                            onChange={(e) => updateModel(c.key, m.id, { label: e.target.value })}
                          />
                          <input
                            className="form-input !h-8 font-mono text-sm"
                            value={m.model}
                            required
                            placeholder="model id"
                            aria-label={`模型 ${mi + 1} 请求 id`}
                            onChange={(e) => updateModel(c.key, m.id, { model: e.target.value })}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                          {m.thinking_capable ? `思考·${levelLab}` : "无思考"}
                          {isDef ? " · 默认" : ""}
                        </span>
                        <button
                          type="button"
                          className="btn-ghost !h-7 !px-2 text-[10px]"
                          title="设为默认"
                          onClick={() => setForm({ ...form, default_endpoint_id: m.id })}
                        >
                          <Star className={"h-3 w-3 " + (isDef ? "fill-current" : "")} />
                        </button>
                        <button
                          type="button"
                          className="btn-ghost !h-7 !w-7 !p-0"
                          disabled={c.models.length <= 1}
                          onClick={() => {
                            setForm((f) => {
                              const nextModels = c.models.filter((x) => x.id !== m.id);
                              let def = f.default_endpoint_id;
                              if (def === m.id) def = nextModels[0]?.id || "";
                              return {
                                ...f,
                                default_endpoint_id: def,
                                connections: f.connections.map((x) =>
                                  x.key === c.key ? { ...x, models: nextModels } : x,
                                ),
                              };
                            });
                          }}
                          aria-label="删除模型"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>

                      {open && (
                        <div className="border-t border-border/60 px-3 py-3 space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                            <Field label="上下文窗口">
                              <input
                                className="form-input font-mono text-sm"
                                type="number"
                                min={1024}
                                value={m.context_window}
                                onChange={(e) =>
                                  updateModel(c.key, m.id, {
                                    context_window: parseInt(e.target.value, 10) || 0,
                                  })
                                }
                              />
                            </Field>
                            <Field label="最大输入">
                              <input
                                className="form-input font-mono text-sm"
                                type="number"
                                min={256}
                                value={m.max_input_tokens}
                                onChange={(e) =>
                                  updateModel(c.key, m.id, {
                                    max_input_tokens: parseInt(e.target.value, 10) || 0,
                                  })
                                }
                              />
                            </Field>
                            <Field label="最大输出（能力）">
                              <input
                                className="form-input font-mono text-sm"
                                type="number"
                                min={64}
                                value={m.max_output_tokens}
                                onChange={(e) =>
                                  updateModel(c.key, m.id, {
                                    max_output_tokens: parseInt(e.target.value, 10) || 0,
                                  })
                                }
                              />
                            </Field>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                            <label className="flex items-center gap-2 text-xs text-foreground">
                              <input
                                type="checkbox"
                                className="accent-[var(--primary)]"
                                checked={m.thinking_capable}
                                onChange={(e) =>
                                  updateModel(c.key, m.id, {
                                    thinking_capable: e.target.checked,
                                    thinking_level: e.target.checked
                                      ? m.thinking_level === "off"
                                        ? "medium"
                                        : m.thinking_level
                                      : "off",
                                  })
                                }
                              />
                              支持思考（extended thinking / reasoning）
                            </label>
                            <Field label="默认思考强度">
                              <select
                                className="form-input"
                                disabled={!m.thinking_capable}
                                value={m.thinking_capable ? m.thinking_level : "off"}
                                onChange={(e) =>
                                  updateModel(c.key, m.id, {
                                    thinking_level: e.target.value,
                                  })
                                }
                              >
                                <option value="off">关闭</option>
                                <option value="low">低</option>
                                <option value="medium">中</option>
                                <option value="high">高</option>
                              </select>
                            </Field>
                          </div>
                          <p className="text-[10px] text-muted-foreground leading-relaxed">
                            Anthropic 路径映射为 thinking.budget_tokens；OpenAI
                            兼容路径尝试 reasoning_effort。对比实验时生成上限仍以 Arena
                            基线为准。
                          </p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        {modelCount < 2 && (
          <p className="text-xs text-warning">
            当前不足 2 个模型：在接入点内「添加模型」，或新建跨厂接入点，才能在 Arena 做模型对比。
          </p>
        )}

        <div className="spectrum-line-soft my-1" aria-hidden />
        <p className="eyebrow">共享解码默认（Arena 基线种子）</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          对比多模型时各列温度 / Top P / 生成上限与 Arena 基线一致；此处仅作默认种子。
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <Field label="Temperature">
            <input
              className="form-input"
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={form.temperature}
              onChange={(e) =>
                setForm({ ...form, temperature: parseFloat(e.target.value) || 0 })
              }
            />
          </Field>
          <Field label="Top P">
            <input
              className="form-input"
              type="number"
              step="0.1"
              min="0"
              max="1"
              value={form.top_p}
              onChange={(e) => setForm({ ...form, top_p: parseFloat(e.target.value) || 0 })}
            />
          </Field>
          <Field label="基线最大输出">
            <input
              className="form-input font-mono text-sm"
              type="number"
              min="64"
              value={form.max_output_tokens}
              onChange={(e) =>
                setForm({
                  ...form,
                  max_output_tokens: parseInt(e.target.value, 10) || 0,
                })
              }
            />
          </Field>
        </div>

        <details className="rounded-[var(--radius-sm)] border border-border bg-muted/10 p-3">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            全局备注（可选）
          </summary>
          <div className="mt-3">
            <input
              className="form-input"
              placeholder="例如：多厂实验台备忘"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </details>

        <div className="flex flex-wrap gap-2 pt-1">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            保存配置
          </button>
        </div>
      </form>

      {toast && (
        <div className="fixed bottom-6 right-6 panel-surface px-4 py-3 text-sm z-50 fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="eyebrow block">{label}</span>
      {children}
    </label>
  );
}
