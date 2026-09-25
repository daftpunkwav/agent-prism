/**
 * @file GuideSection
 * @description The settings guide tab: one page explaining every settings group.
 *
 * Responsibilities:
 * - Render per-group explanations from the settings.guide catalog namespace
 * - Stay static: no form state, pure documentation
 */

import { BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { UiSelect } from "@agentprism/ui";
import { useT } from "@/i18n/useT";
import { DEFAULT_SKIN, SKINS, SKIN_STORAGE_KEY, applySkin, normalizeSkin } from "@/theme";

const GROUPS: ReadonlyArray<{ key: string; icon: typeof BookOpen }> = [
  { key: "connections", icon: BookOpen },
  { key: "thinking", icon: BookOpen },
  { key: "decode", icon: BookOpen },
  { key: "runtime", icon: BookOpen },
  { key: "memory", icon: BookOpen },
  { key: "skills", icon: BookOpen },
  { key: "mcp", icon: BookOpen },
];

/** Settings guide: documentation-only section describing every settings group. */
export function GuideSection() {
  const t = useT();
  const [skin, setSkin] = useState(DEFAULT_SKIN);
  useEffect(() => {
    setSkin(normalizeSkin(localStorage.getItem(SKIN_STORAGE_KEY)));
  }, []);
  const skinOptions = SKINS.map((name) => ({ value: name, label: t(`settings.skin.${name}` as never) }));
  const onSkin = (value: string) => {
    localStorage.setItem(SKIN_STORAGE_KEY, value);
    applySkin(value);
    setSkin(value);
  };
  return (
    <section aria-label={t("settings.section.guide")} className="space-y-4">
      <div>
        <p className="eyebrow flex items-center gap-2">
          <BookOpen className="h-4 w-4" />
          {t("settings.section.guide")}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.guide.intro")}</p>
      </div>
      <div className="flex items-center gap-3 rounded-lg border border-border/60 p-3.5">
        <span className="text-xs text-foreground">{t("settings.skin.label")}</span>
        <UiSelect
          className="w-48"
          value={skin}
          onChange={onSkin}
          ariaLabel={t("settings.skin.label")}
          options={skinOptions}
        />
      </div>
      {GROUPS.map(({ key, icon: Icon }) => (
        <div key={key} className="rounded-lg border border-border/60 p-3.5 space-y-2">
          <p className="eyebrow flex items-center gap-2">
            <Icon className="h-3.5 w-3.5" />
            {t(`settings.guide.${key}.title` as never)}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
            {t(`settings.guide.${key}.body` as never)}
          </p>
        </div>
      ))}
    </section>
  );
}
