/**
 * @file SkillsSection
 * @description Settings tab managing the skill catalog: search, enable toggles, user-skill CRUD.
 *
 * Responsibilities:
 * - Fetch the full catalog (bundled + user) and filter it by search text
 * - Toggle skills enabled/disabled (persists server-side, next turn applies)
 * - Create, edit, and delete user skills; bundled skills stay read-only
 *
 * Self-fetching like RuntimeKnobsSection: props are the flash callback only.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import {
  createSkill,
  deleteSkill,
  fetchSkills,
  setSkillEnabled,
  updateSkill,
  type SkillEntry,
} from "@agentprism/client";
import { useT } from "@/i18n/useT";
import { Toggle } from "./Toggle";

/** Inline create/edit form for one user skill. */
function SkillForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: SkillEntry | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      if (initial === null) {
        await createSkill({ name: name.trim(), description, body });
      } else {
        // Empty body means "keep the existing body": the server rejects blanks.
        await updateSkill(initial.name, body.trim() === "" ? { description } : { description, body });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel-surface !shadow-none p-4 space-y-3 border-primary/30">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{initial === null ? t("settings.skills.createTitle") : t("settings.skills.editTitle", { name: initial.name })}</p>
        <button type="button" className="btn-ghost !h-7 !w-7 !p-0" aria-label={t("settings.skills.cancel")} onClick={onCancel}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {initial === null && (
        <input
          className="form-input"
          value={name}
          placeholder={t("settings.skills.namePlaceholder")}
          onChange={(event) => setName(event.target.value)}
        />
      )}
      <input
        className="form-input"
        value={description}
        placeholder={t("settings.skills.descriptionPlaceholder")}
        onChange={(event) => setDescription(event.target.value)}
      />
      <textarea
        className="form-input font-mono text-xs"
        rows={8}
        value={body}
        placeholder={t("settings.skills.bodyPlaceholder")}
        onChange={(event) => setBody(event.target.value)}
      />
      {error !== null && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          {t("settings.skills.cancel")}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={saving || (initial === null && (name.trim() === "" || description.trim() === "" || body.trim() === ""))}
          onClick={() => void submit()}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("settings.skills.save")}
        </button>
      </div>
    </div>
  );
}

/** Settings tab: the searchable, toggleable skill catalog with user CRUD. */
export function SkillsSection({ onFlash }: { onFlash: (message: string) => void }) {
  const t = useT();
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ mode: "create" } | { mode: "edit"; skill: SkillEntry } | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setSkills(await fetchSkills());
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
    if (q === "") return skills;
    return skills.filter((skill) => skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q));
  }, [skills, query]);

  const toggle = async (skill: SkillEntry): Promise<void> => {
    setBusyName(skill.name);
    try {
      await setSkillEnabled(skill.name, !skill.enabled);
      setSkills((prev) => prev.map((s) => (s.name === skill.name ? { ...s, enabled: !skill.enabled } : s)));
    } catch (err) {
      onFlash(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyName(null);
    }
  };

  const remove = async (skill: SkillEntry): Promise<void> => {
    if (!window.confirm(t("settings.skills.deleteConfirm", { name: skill.name }))) return;
    setBusyName(skill.name);
    try {
      await deleteSkill(skill.name);
      await reload();
    } catch (err) {
      onFlash(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyName(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <p className="text-sm">{t("settings.skills.loading")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold">{t("settings.skills.title")}</h2>
        <span className="text-xs text-muted-foreground font-mono">{t("settings.skills.count", { count: skills.length })}</span>
      </div>
      {loadError !== null && <p className="text-xs text-destructive">{loadError}</p>}
      <p className="text-xs text-muted-foreground">{t("settings.skills.hint")}</p>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <input
            className="form-input !pl-8"
            value={query}
            placeholder={t("settings.skills.searchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button type="button" className="btn-primary shrink-0" onClick={() => setEditing({ mode: "create" })}>
          <Plus className="h-4 w-4" />
          {t("settings.skills.create")}
        </button>
      </div>

      {editing !== null && (
        <SkillForm
          initial={editing.mode === "edit" ? editing.skill : null}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}

      <div className="panel-surface !shadow-none divide-y divide-border/60">
        {filtered.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t("settings.skills.empty")}</p>
        ) : (
          filtered.map((skill) => (
            <div key={`${skill.source}-${skill.name}`} className="flex items-center gap-3 px-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-border bg-muted/60">
                <Sparkles className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{skill.name}</span>
                  <span className="shrink-0 rounded-none border border-border px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground uppercase">
                    {skill.source}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground" title={skill.description}>
                  {skill.description}
                </p>
              </div>
              {skill.source === "user" && (
                <>
                  <button
                    type="button"
                    className="btn-ghost !h-7 !w-7 !p-0 shrink-0"
                    aria-label={t("settings.skills.editAria", { name: skill.name })}
                    onClick={() => setEditing({ mode: "edit", skill })}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn-ghost !h-7 !w-7 !p-0 shrink-0 text-destructive"
                    aria-label={t("settings.skills.deleteAria", { name: skill.name })}
                    disabled={busyName === skill.name}
                    onClick={() => void remove(skill)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
              <Toggle
                checked={skill.enabled}
                onChange={() => void toggle(skill)}
                label={t("settings.skills.toggleAria", { name: skill.name })}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
