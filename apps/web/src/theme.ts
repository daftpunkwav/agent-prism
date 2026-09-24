/**
 * @file theme
 * @description The localStorage key for theme persistence (single source).
 *
 * Responsibilities:
 * - Share the key between the layout inline script and ThemeToggle
 */

/** localStorage key for theme persistence (web-side single source: layout inline script and ThemeToggle share it). */
export const THEME_STORAGE_KEY = "agentprism-theme";

/** localStorage key for the skin (theme family: "21th" default | "claude"). */
export const SKIN_STORAGE_KEY = "agentprism-skin";

/** Available skins; the value lands on <html data-theme> (CSS: tokens.css). */
export const SKINS = ["21th", "claude"] as const;
export type Skin = (typeof SKINS)[number];

/** Applies the skin to the document root (no-op outside a browser). */
export function applySkin(skin: string): void {
  if (skin === "claude") {
    document.documentElement.dataset.theme = "claude";
  } else {
    delete document.documentElement.dataset.theme;
  }
}
