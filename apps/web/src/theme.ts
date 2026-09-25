/**
 * @file theme
 * @description Skin and mode persistence keys plus the skin registry (single source).
 *
 * Responsibilities:
 * - Share the keys between the layout inline script, ThemeToggle, and the skin picker
 * - Own the skin id list: a skin id is valid iff it is registered here
 */

/** localStorage key for theme persistence (web-side single source: layout inline script and ThemeToggle share it). */
export const THEME_STORAGE_KEY = "agentprism-theme";

/** localStorage key for the skin (theme family). */
export const SKIN_STORAGE_KEY = "agentprism-skin";

/** The skin id that needs no [data-theme] attribute: tokens.css :root IS this skin. */
export const DEFAULT_SKIN = "21th";

/**
 * Available skins; the value lands on <html data-theme> (CSS: styles/skins/*.css,
 * one self-contained file per id). Registration order is picker order.
 */
export const SKINS = [
  DEFAULT_SKIN,
  "claude",
  "apple",
  "google",
  "tiktok",
  "nerv",
  "motion-fit",
  "minimalist",
  "goldentime",
  "vibecamp",
  "vercel",
] as const;
export type Skin = (typeof SKINS)[number];

/** Narrows an arbitrary stored value to a registered skin, falling back to the default. */
export function normalizeSkin(value: string | null | undefined): Skin {
  return (SKINS as readonly string[]).includes(value ?? "") ? (value as Skin) : DEFAULT_SKIN;
}

/** Applies the skin to the document root (browser only; callers are client components). Unknown values fall back to the default skin. */
export function applySkin(skin: string): void {
  const next = normalizeSkin(skin);
  if (next === DEFAULT_SKIN) {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = next;
  }
}
