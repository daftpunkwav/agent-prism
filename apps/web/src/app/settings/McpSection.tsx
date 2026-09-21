/**
 * @file McpSection
 * @description Settings tab managing the MCP server list: search, enable toggles, CRUD.
 *
 * Responsibilities:
 * - Fetch the managed server list and filter it by search text
 * - Toggle servers enabled/disabled inside a full-list replace
 * - Create, edit, and delete server configs (persisted + hot-applied)
 *
 * Self-fetching like SkillsSection: props are the flash callback only.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plug, Plus, Search, Trash2, X } from "lucide-react";
import {
  fetchMcpServers,
  saveMcpServers,
  type McpServerEntry,
} from "@agentprism/client";
import { useT } from "@/i18n/useT";

/** Renders one row's enable switch (shared settings toggle look). */
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors " +
        (checked ? "border-primary/60 bg-primary/80" : "border-border bg-muted")
      }
      onClick={() => onChange(!checked)}
    >
      <span
        className={
          "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-background transition-all " +
          (checked ? "left-[1.15rem]" : "left-0.5")
        }
      />
    </button>
  );
}

/** Display name for a server row: explicit name or the command basename. */
function displayName(server: McpServerEntry): string {
  if (server.name !== undefined && server.name !== "") return server.name;
  const parts = server.command.split(/[\\/]/);
  return parts[parts.length - 1] ?? server.command;
}

/** One-line transport summary: command + args (truncated). */
function transportSummary(server: McpServerEntry): string {
  const line = [server.command, ...(server.args ?? [])].join(" ");
  return line.length > 110 ? line.slice(0, 110) + "…" : line;
}

interface ServerDraft {
  name: string;
  command: string;
  argsText: string;
  envText: string;
  timeoutMs: string;
  toolsText: string;
  enabled: boolean;
}

function draftOf(server: McpServerEntry | null): ServerDraft {
  return {
    name: server?.name ?? "",
    command: server?.command ?? "",
    argsText: (server?.args ?? []).join("\n"),
    envText: server?.env !== undefined && Object.keys(server.env).length > 0 ? JSON.stringify(server.env, null, 2) : "",
    timeoutMs: server?.timeoutMs !== undefined ? String(server.timeoutMs) : "",
    toolsText: (server?.tools ?? []).join(", "),
    enabled: server?.enabled ?? true,
  };
}

/** Inline create/edit form for one server config. */
function ServerForm({
  initial,
  onCancel,
  onSaved,
  onFlash,
}: {
  initial: McpServerEntry | null;
  onCancel: () => void;
  onSaved: () => void;
  onFlash: (message: string) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<ServerDraft>(draftOf(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (next: Partial<ServerDraft>) => setDraft((prev) => ({ ...prev, ...next }));

  const submit = async (): Promise<void> => {
    setError(null);
    const command = draft.command.trim();
    if (command === "") {
      setError(t("settings.mcp.errorCommand"));
      return;
    }
    let env: Record<string, string> | undefined;
    if (draft.envText.trim() !== "") {
      try {
        const parsed = JSON.parse(draft.envText) as unknown;
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        env = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
      } catch {
        setError(t("settings.mcp.errorEnv"));
        return;
      }
    }
    const server: McpServerEntry = {
      command,
      ...(draft.name.trim() !== "" ? { name: draft.name.trim() } : {}),
      ...(draft.argsText.trim() !== "" ? { args: draft.argsText.split("\n").map((line) => line.trim()).filter((line) => line !== "") } : {}),
      ...(env !== undefined ? { env } : {}),
      ...(draft.timeoutMs.trim() !== "" ? { timeoutMs: Number(draft.timeoutMs) } : {}),
      ...(draft.toolsText.trim() !== ""
        ? { tools: draft.toolsText.split(",").map((tool) => tool.trim()).filter((tool) => tool !== "") }
        : {}),
      enabled: draft.enabled,
    };
    setSaving(true);
    try {
      const current = await fetchMcpServers();
      // Identity: explicit name, else the command itself (one command = one server).
      const key = (entry: McpServerEntry) => entry.name ?? entry.command;
      const nextList =
        initial === null
          ? [...current, server]
          : current.map((entry) => (key(entry) === key(initial) ? server : entry));
      await saveMcpServers(nextList);
      onSaved();
    } catch (err) {
      onFlash(err instanceof Error ? err.message : String(err));
      setError(t("settings.mcp.errorSave"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel-surface !shadow-none p-4 space-y-3 border-primary/30">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{initial === null ? t("settings.mcp.createTitle") : t("settings.mcp.editTitle", { name: displayName(initial) })}</p>
        <button type="button" className="btn-ghost !h-7 !w-7 !p-0" aria-label={t("settings.mcp.cancel")} onClick={onCancel}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <input
          className="form-input"
          value={draft.name}
          placeholder={t("settings.mcp.namePlaceholder")}
          onChange={(event) => patch({ name: event.target.value })}
        />
        <input
          className="form-input"
          value={draft.command}
          placeholder={t("settings.mcp.commandPlaceholder")}
          onChange={(event) => patch({ command: event.target.value })}
        />
      </div>
      <textarea
        className="form-input font-mono text-xs"
        rows={3}
        value={draft.argsText}
        placeholder={t("settings.mcp.argsPlaceholder")}
        onChange={(event) => patch({ argsText: event.target.value })}
      />
      <textarea
        className="form-input font-mono text-xs"
        rows={3}
        value={draft.envText}
        placeholder={t("settings.mcp.envPlaceholder")}
        onChange={(event) => patch({ envText: event.target.value })}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <input
          className="form-input font-mono text-xs"
          value={draft.timeoutMs}
          placeholder={t("settings.mcp.timeoutPlaceholder")}
          onChange={(event) => patch({ timeoutMs: event.target.value.replace(/\D/g, "") })}
        />
        <input
          className="form-input"
          value={draft.toolsText}
          placeholder={t("settings.mcp.toolsPlaceholder")}
          onChange={(event) => patch({ toolsText: event.target.value })}
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Toggle checked={draft.enabled} onChange={(next) => patch({ enabled: next })} label={t("settings.mcp.enabledAria")} />
        {t("settings.mcp.enabledLabel")}
      </label>
      {error !== null && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          {t("settings.mcp.cancel")}
        </button>
        <button type="button" className="btn-primary" disabled={saving} onClick={() => void submit()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("settings.mcp.save")}
        </button>
      </div>
    </div>
  );
}

/** Settings tab: the searchable MCP server list with full CRUD. */
export function McpSection({ onFlash }: { onFlash: (message: string) => void }) {
  const t = useT();
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ mode: "create" } | { mode: "edit"; server: McpServerEntry } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setServers(await fetchMcpServers());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return servers;
    return servers.filter(
      (server) =>
        displayName(server).toLowerCase().includes(q) ||
        server.command.toLowerCase().includes(q) ||
        (server.name ?? "").toLowerCase().includes(q),
    );
  }, [servers, query]);

  const replaceList = async (next: McpServerEntry[]): Promise<boolean> => {
    try {
      setServers(await saveMcpServers(next));
      return true;
    } catch (err) {
      onFlash(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const toggle = async (server: McpServerEntry): Promise<void> => {
    const key = server.name ?? server.command;
    setBusyKey(key);
    const next = servers.map((entry) => (entry === server ? { ...entry, enabled: !(entry.enabled ?? true) } : entry));
    const ok = await replaceList(next);
    if (!ok) setBusyKey(null);
    else setBusyKey(null);
  };

  const remove = async (server: McpServerEntry): Promise<void> => {
    if (!window.confirm(t("settings.mcp.deleteConfirm", { name: displayName(server) }))) return;
    const key = server.name ?? server.command;
    setBusyKey(key);
    const ok = await replaceList(servers.filter((entry) => entry !== server));
    if (!ok) setBusyKey(null);
    else setBusyKey(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <p className="text-sm">{t("settings.mcp.loading")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold">{t("settings.mcp.title")}</h2>
        <span className="text-xs text-muted-foreground font-mono">{t("settings.mcp.count", { count: servers.length })}</span>
      </div>
      {loadError !== null && <p className="text-xs text-destructive">{loadError}</p>}
      <p className="text-xs text-muted-foreground">{t("settings.mcp.hint")}</p>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <input
            className="form-input !pl-8"
            value={query}
            placeholder={t("settings.mcp.searchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button type="button" className="btn-primary shrink-0" onClick={() => setEditing({ mode: "create" })}>
          <Plus className="h-4 w-4" />
          {t("settings.mcp.create")}
        </button>
      </div>

      {editing !== null && (
        <ServerForm
          initial={editing.mode === "edit" ? editing.server : null}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
          onFlash={onFlash}
        />
      )}

      <div className="panel-surface !shadow-none divide-y divide-border/60">
        {filtered.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t("settings.mcp.empty")}</p>
        ) : (
          filtered.map((server) => {
            const key = server.name ?? server.command;
            const enabled = server.enabled ?? true;
            return (
              <div key={key} className="flex items-center gap-3 px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-border bg-muted/60">
                  <Plug className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={"text-sm font-medium truncate " + (enabled ? "" : "line-through text-muted-foreground")}>
                      {displayName(server)}
                    </span>
                    {!enabled && (
                      <span className="shrink-0 rounded-none border border-border px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground uppercase">
                        {t("settings.mcp.disabledBadge")}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground font-mono" title={transportSummary(server)}>
                    {transportSummary(server)}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost !h-7 !w-7 !p-0 shrink-0"
                  aria-label={t("settings.mcp.editAria", { name: displayName(server) })}
                  onClick={() => setEditing({ mode: "edit", server })}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="btn-ghost !h-7 !w-7 !p-0 shrink-0 text-destructive"
                  aria-label={t("settings.mcp.deleteAria", { name: displayName(server) })}
                  disabled={busyKey === key}
                  onClick={() => void remove(server)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <Toggle
                  checked={enabled}
                  onChange={() => void toggle(server)}
                  label={t("settings.mcp.toggleAria", { name: displayName(server) })}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
