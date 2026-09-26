/**
 * @file skin contrast tests
 * @description WCAG contrast gate for every theme surface: parses tokens.css (the
 *              default 21th light/dark pair) and every skin file (light + dark blocks)
 *              and enforces minimum ratios on the pairs the app actually renders text in.
 *
 * Thresholds:
 * - 4.5:1 for body text, secondary text, status text (success/warning/destructive
 *   render at 10-13px), accent-colored text (brand wordmark, selected items, badges,
 *   link hover via --accent-text), and lane text (spectrum-1..4 render in trace
 *   badges, guide kickers and column accents)
 * - 3.0:1 for text sitting on a colored surface (buttons, status glyph surfaces)
 *   and for --primary used as text (mostly decorative icons)
 * - --accent used as a SURFACE keeps its own gated pair (--accent-foreground);
 *   accent-colored TEXT goes through --accent-text, which every skin declares
 *   (a text-safe derivative or var(--accent) when the accent itself clears 4.5:1).
 *
 * Surfaces include the composite tints the app actually paints: badges and chips
 * render text on the token's own 8-10% tint over card, and guide hero pillars
 * render lane text on --input.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_DIR = join(process.cwd(), "packages/ui/ui/styles");

/** WCAG relative contrast ratio between two hex colors. */
function contrast(a: string, b: string): number {
  const lum = (hex: string): number => {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const [r, g, bl] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    return 0.2126 * lin(r ?? 0) + 0.7152 * lin(g ?? 0) + 0.0722 * lin(bl ?? 0);
  };
  const sorted = [lum(a), lum(b)].sort((x, y) => y - x);
  const hi = sorted[0] ?? 0;
  const lo = sorted[1] ?? 0;
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB channel blend of fg over bg at the given alpha (browser compositing). */
function blend(fg: string, bg: string, alpha: number): string {
  const rgb = (hex: string): number[] => {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  };
  const f = rgb(fg);
  const b = rgb(bg);
  return "#" + f.map((v, i) => Math.round(v * alpha + (b[i] ?? 0) * (1 - alpha)).toString(16).padStart(2, "0")).join("");
}

/** Extracts flat `selector { decl; ... }` blocks with custom properties only. */
function extractBlocks(css: string): Map<string, Record<string, string>> {
  const blocks = new Map<string, Record<string, string>>();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const sel = (m[1] ?? "").trim().replace(/\s+/g, " ");
    const vars: Record<string, string> = {};
    for (const decl of (m[2] ?? "").split(";")) {
      const idx = decl.indexOf(":");
      if (idx === -1) continue;
      const name = decl.slice(0, idx).trim();
      if (name.startsWith("--")) vars[name] = decl.slice(idx + 1).trim();
    }
    if (Object.keys(vars).length > 0) blocks.set(sel, vars);
  }
  return blocks;
}

/** Resolves var() chains down to a plain hex; returns null for anything else. */
function resolveHex(value: string | undefined, vars: Record<string, string>, depth = 0): string | null {
  if (depth > 8 || value == null) return null;
  const v = value.trim();
  if (v.startsWith("var(")) {
    const name = v.slice(4, v.indexOf(")")).trim();
    return resolveHex(vars[name], vars, depth + 1);
  }
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : null;
}

/** Flat token pairs with their minimum WCAG ratios. */
const PAIRS: ReadonlyArray<readonly [fgName: string, bgName: string, min: number]> = [
  // Body text on every surface it lands on.
  ["foreground", "background", 4.5],
  ["foreground", "card", 4.5],
  ["foreground", "muted", 4.5],
  ["card-foreground", "card", 4.5],
  ["popover-foreground", "popover", 4.5],
  ["muted-foreground", "background", 4.5],
  ["muted-foreground", "card", 4.5],
  ["muted-foreground", "muted", 4.5],
  ["muted-foreground", "popover", 4.5],
  // Colored tokens used AS TEXT (links, badges, legends, kickers, icons).
  ["accent-text", "background", 4.5],
  ["accent-text", "card", 4.5],
  ["accent-text", "muted", 4.5],
  ["accent-text", "popover", 4.5],
  // Status text surfaces: settings sections (card), modals (popover), page
  // banners (background). No component renders status text on --muted.
  ["success", "background", 4.5],
  ["success", "card", 4.5],
  ["success", "popover", 4.5],
  ["warning", "background", 4.5],
  ["warning", "card", 4.5],
  ["warning", "popover", 4.5],
  ["destructive", "background", 4.5],
  ["destructive", "card", 4.5],
  ["destructive", "popover", 4.5],
  // Lane text surfaces: guide kickers (background + --input pillar cards) and
  // trace badges / legends (card and muted-tint blends).
  ["spectrum-1", "background", 4.5],
  ["spectrum-1", "card", 4.5],
  ["spectrum-1", "muted", 4.5],
  ["spectrum-1", "input", 4.5],
  ["spectrum-2", "background", 4.5],
  ["spectrum-2", "card", 4.5],
  ["spectrum-2", "muted", 4.5],
  ["spectrum-2", "input", 4.5],
  ["spectrum-3", "background", 4.5],
  ["spectrum-3", "card", 4.5],
  ["spectrum-3", "muted", 4.5],
  ["spectrum-3", "input", 4.5],
  ["spectrum-4", "background", 4.5],
  ["spectrum-4", "card", 4.5],
  ["spectrum-4", "muted", 4.5],
  ["spectrum-4", "input", 4.5],
  ["primary", "background", 3.0],
  ["primary", "card", 3.0],
  ["primary", "muted", 3.0],
  ["primary", "popover", 3.0],
  // Ink on colored surfaces (buttons, chips).
  ["primary-foreground", "primary", 3.0],
  ["secondary-foreground", "secondary", 3.0],
  ["accent-foreground", "accent", 3.0],
  ["destructive-foreground", "destructive", 3.0],
];

/** Composite pairs: fg token on the tint its own surface token paints over a base surface. */
const TINT_PAIRS: ReadonlyArray<readonly [fgName: string, tintToken: string, overBg: string, min: number]> = [
  // trace-kind badges / seed badge / guide-ledger code: text on accent 10% over card
  ["accent-text", "accent", "card", 4.5],
  // status chips (bg-*/10, bg-*/5) and result/error badges (8%): 10% binds
  ["success", "success", "card", 4.5],
  ["warning", "warning", "card", 4.5],
  ["destructive", "destructive", "card", 4.5],
  // answer badge + ColumnCard icon box: lane text on lane 10% over card
  ["spectrum-1", "spectrum-1", "card", 4.5],
  ["spectrum-2", "spectrum-2", "card", 4.5],
  ["spectrum-3", "spectrum-3", "card", 4.5],
  ["spectrum-4", "spectrum-4", "card", 4.5],
  // selected/hover chips: primary text on primary 10% over card
  ["primary", "primary", "card", 3.0],
];

/** Collects every themed surface: default 21th (tokens.css) plus each skin file. */
type TokenVars = Record<string, string>;
type ThemedSurface = readonly [name: string, vars: TokenVars | null];

function themedSurfaces(): ThemedSurface[] {
  const surfaces: ThemedSurface[] = [];
  const tokenBlocks = extractBlocks(readFileSync(join(STYLES_DIR, "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));
  const rootVars = tokenBlocks.get(":root");
  const darkVars = tokenBlocks.get(".dark");
  // The gate must never silently shrink: the 21th blocks ARE the default skin.
  expect(rootVars, "tokens.css :root block missing").toBeDefined();
  expect(darkVars, "tokens.css .dark block missing").toBeDefined();
  surfaces.push(["21th light", rootVars ?? null]);
  surfaces.push(["21th dark", darkVars ?? null]);

  const skinsDir = join(STYLES_DIR, "skins");
  for (const file of readdirSync(skinsDir).sort()) {
    if (!file.endsWith(".css") || file === "index.css") continue;
    const id = file.replace(/\.css$/, "");
    const blocks = extractBlocks(readFileSync(join(skinsDir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));
    const light = blocks.get(`[data-theme="${id}"]`);
    const dark = blocks.get(`[data-theme="${id}"].dark`);
    // Runtime cascade order on <html data-theme="id" class="dark">: tokens :root,
    // tokens .dark, skin light block, skin dark block (later same-specificity wins).
    if (light) surfaces.push([`${id} light`, { ...rootVars, ...light }]);
    if (dark) surfaces.push([`${id} dark`, { ...rootVars, ...darkVars, ...light, ...dark }]);
  }
  return surfaces;
}

describe("skin contrast", () => {
  const surfaces = themedSurfaces();

  it("finds both a light and a dark surface for the default and every skin", () => {
    const names = surfaces.map(([name]) => name);
    for (const id of ["claude", "apple", "google", "tiktok", "nerv", "motion-fit", "minimalist", "goldentime", "vibecamp", "vercel"]) {
      expect(names).toContain(`${id} light`);
      expect(names).toContain(`${id} dark`);
    }
  });

  it("declares --accent-text explicitly in every skin block (no cascade leak from tokens.css)", () => {
    // The merged vars would make a resolution check pass even for a skin that
    // lost its own declaration (it would inherit 21th's value at runtime), so
    // assert on the raw blocks.
    const skinsDir = join(STYLES_DIR, "skins");
    for (const file of readdirSync(skinsDir).sort()) {
      if (!file.endsWith(".css") || file === "index.css") continue;
      const blocks = extractBlocks(readFileSync(join(skinsDir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));
      const light = blocks.get(`[data-theme="${file.replace(/\.css$/, "")}"]`);
      const dark = blocks.get(`[data-theme="${file.replace(/\.css$/, "")}"].dark`);
      expect(light?.["--accent-text"], `${file} light block must declare --accent-text`).toBeDefined();
      expect(dark?.["--accent-text"], `${file} dark block must declare --accent-text`).toBeDefined();
    }
  });

  it("keeps every text-bearing pair above the WCAG minimum in every surface", () => {
    for (const [name, vars] of surfaces) {
      const tokenVars = vars as TokenVars;
      for (const [fgName, bgName, min] of PAIRS) {
        const fg = resolveHex(tokenVars[`--${fgName}`], tokenVars);
        const bg = resolveHex(tokenVars[`--${bgName}`], tokenVars);
        expect(fg, `${name}: --${fgName} must be a plain hex (got ${tokenVars[`--${fgName}`]})`).not.toBeNull();
        expect(bg, `${name}: --${bgName} must be a plain hex (got ${tokenVars[`--${bgName}`]})`).not.toBeNull();
        const fgHex = fg as string;
        const bgHex = bg as string;
        const ratio = contrast(fgHex, bgHex);
        expect(
          ratio,
          `${name}: --${fgName} on --${bgName} is ${ratio.toFixed(2)}:1, below ${min}:1`,
        ).toBeGreaterThanOrEqual(min);
      }
      for (const [fgName, tintToken, overBg, min] of TINT_PAIRS) {
        const fg = resolveHex(tokenVars[`--${fgName}`], tokenVars);
        const tintBase = resolveHex(tokenVars[`--${tintToken}`], tokenVars);
        const base = resolveHex(tokenVars[`--${overBg}`], tokenVars);
        expect(fg, `${name}: --${fgName} must be a plain hex`).not.toBeNull();
        expect(tintBase, `${name}: --${tintToken} must be a plain hex`).not.toBeNull();
        expect(base, `${name}: --${overBg} must be a plain hex`).not.toBeNull();
        const bg = blend(tintBase as string, base as string, 0.1);
        const ratio = contrast(fg as string, bg);
        expect(
          ratio,
          `${name}: --${fgName} on --${tintToken} 10% over --${overBg} (${bg}) is ${ratio.toFixed(2)}:1, below ${min}:1`,
        ).toBeGreaterThanOrEqual(min);
      }
    }
  });
});
