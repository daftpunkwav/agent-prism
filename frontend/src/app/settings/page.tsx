"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Eye, EyeOff, Loader2, Zap } from "lucide-react";
import { ProviderConfig, fetchProvider, saveProvider, testProvider } from "@/lib/api";

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [form, setForm] = useState({
    provider_name: "StepFun",
    notes: "",
    website_url: "https://platform.stepfun.com/step-plan",
    api_key: "",
    base_url: "https://api.stepfun.com/step_plan",
    use_full_url: true,
    api_format: "anthropic_messages",
    auth_field: "ANTHROPIC_AUTH_TOKEN",
    model: "step-3.7-flash",
    temperature: 0,
    context_window: 128000,
    max_input_tokens: 120000,
    max_output_tokens: 2048,
  });
  const abortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    // 组件卸载时取消 in-flight 请求，避免 setState on unmounted
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    fetchProvider({ signal: ac.signal })
      .then((cfg: ProviderConfig) => {
        setForm((f) => ({
          ...f,
          provider_name: cfg.provider_name ?? f.provider_name,
          notes: cfg.notes ?? f.notes,
          website_url: cfg.website_url ?? f.website_url,
          base_url: cfg.base_url ?? f.base_url,
          use_full_url: cfg.use_full_url ?? f.use_full_url,
          api_format: cfg.api_format ?? f.api_format,
          auth_field: cfg.auth_field ?? f.auth_field,
          model: cfg.model ?? f.model,
          temperature: cfg.temperature ?? f.temperature,
          context_window: cfg.context_window ?? f.context_window,
          max_input_tokens: cfg.max_input_tokens ?? f.max_input_tokens,
          max_output_tokens: cfg.max_output_tokens ?? f.max_output_tokens,
          api_key: "",
        }));
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

  // 卸载时清理 toast 定时器
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveProvider(form);
      flash("Provider 配置已保存");
    } catch {
      flash("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testProvider(form);
      setTestResult(res);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
        <div className="flex items-center">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          加载配置…
        </div>
        {loadError && (
          <p className="text-xs text-destructive">{loadError}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="eyebrow mb-2">BYOK</p>
        <h1 className="text-2xl font-semibold">Provider 配置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          自带 API Key 运行 Arena 实验。Key 仅保存在本地，不会上传到远程。
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5 rounded-[var(--radius)] border border-border bg-card p-6">
        <Field label="供应商名称">
          <input
            className="form-input"
            value={form.provider_name}
            onChange={(e) => setForm({ ...form, provider_name: e.target.value })}
          />
        </Field>

        <Field label="备注">
          <input
            className="form-input"
            placeholder="例如：StepFun Plan 专用"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>

        <Field label="官网链接">
          <div className="flex gap-2">
            <input
              className="form-input"
              value={form.website_url}
              onChange={(e) => setForm({ ...form, website_url: e.target.value })}
            />
            <a
              href={form.website_url}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost shrink-0"
              aria-label="打开官网链接"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </Field>

        <Field label="API Key">
          <div className="relative">
            <input
              className="form-input pr-12 font-mono text-sm"
              type={showKey ? "text" : "password"}
              placeholder="留空则保持已保存的 Key"
              value={form.api_key}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })}
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              onClick={() => setShowKey(!showKey)}
              aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>

        <Field label="请求地址">
          <input
            className="form-input font-mono text-sm"
            value={form.base_url}
            onChange={(e) => setForm({ ...form, base_url: e.target.value })}
          />
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={form.use_full_url}
              onChange={(e) => setForm({ ...form, use_full_url: e.target.checked })}
            />
            完整 URL
          </label>
        </Field>

        <details className="rounded-[calc(var(--radius)-6px)] border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">高级选项</summary>
          <div className="mt-4 space-y-4">
            <Field label="API 格式">
              <select
                className="form-input"
                value={form.api_format}
                onChange={(e) => setForm({ ...form, api_format: e.target.value })}
              >
                <option value="anthropic_messages">Anthropic Messages（原生）</option>
                <option value="openai_chat">OpenAI Chat（预留）</option>
              </select>
            </Field>
            <Field label="认证字段">
              <select
                className="form-input"
                value={form.auth_field}
                onChange={(e) => setForm({ ...form, auth_field: e.target.value })}
              >
                <option value="ANTHROPIC_AUTH_TOKEN">ANTHROPIC_AUTH_TOKEN（默认）</option>
              </select>
            </Field>
          </div>
        </details>

        <div className="rounded border border-border p-4 space-y-4">
          <p className="eyebrow">模型映射</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="实际请求模型">
              <input
                className="form-input font-mono text-sm"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
            </Field>
            <Field label="Temperature">
              <input
                className="form-input"
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={form.temperature}
                onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) })}
              />
            </Field>
          </div>
          <p className="eyebrow pt-2">上下文窗口</p>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <Field label="上下文窗口 (tokens)">
              <input
                className="form-input font-mono text-sm"
                type="number"
                min="1024"
                value={form.context_window}
                onChange={(e) => setForm({ ...form, context_window: parseInt(e.target.value, 10) || 0 })}
              />
            </Field>
            <Field label="最大输入 (tokens)">
              <input
                className="form-input font-mono text-sm"
                type="number"
                min="256"
                value={form.max_input_tokens}
                onChange={(e) => setForm({ ...form, max_input_tokens: parseInt(e.target.value, 10) || 0 })}
              />
            </Field>
            <Field label="最大输出 (tokens)">
              <input
                className="form-input font-mono text-sm"
                type="number"
                min="64"
                value={form.max_output_tokens}
                onChange={(e) => setForm({ ...form, max_output_tokens: parseInt(e.target.value, 10) || 0 })}
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            上下文占比 = (输入 + 输出) / 上下文窗口；输入占比 = 输入 / 最大输入。
          </p>
        </div>

        {testResult && (
          <div
            className={`rounded border p-3 text-sm ${
              testResult.ok
                ? "border-foreground/30 bg-muted text-foreground"
                : "border-destructive/40 bg-destructive/10 text-destructive"
            }`}
          >
            {testResult.message}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            保存配置
          </button>
          <button type="button" className="btn-ghost" onClick={onTest} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            管理与测试
          </button>
        </div>
      </form>

      {toast && (
        <div className="fixed bottom-6 right-6 rounded-[calc(var(--radius)-6px)] border border-border bg-card px-4 py-3 text-sm shadow-lg">
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
