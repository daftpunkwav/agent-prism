/**
 * @file skin contrast tests
 * @description WCAG contrast gate for every theme surface: parses tokens.css (the
 *              default 21th light/dark pair) and every skin file (light + dark blocks)
 *              and enforces minimum ratios on the pairs the app actually renders text in.
 *
 * Thresholds:
 * - 4.5:1 for body/secondary text tokens (the app renders 10-13px mono text)
 * - 3.0:1 for text sitting on a colored surface (buttons, status glyphs)
 * - "--accent used as text on card" is intentionally NOT gated: the default dark
 *   palette ships 2.63:1 there and accent renders as a surface, not body copy.
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

/** Text-bearing token pairs with their minimum WCAG ratios. */
const PAIRS: ReadonlyArray<readonly [fgName: string, bgName: string, min: number]> = [
  ["foreground", "background", 4.5],
  ["foreground", "card", 4.5],
  ["foreground", "muted", 4.5],
  ["card-foreground", "card", 4.5],
  ["popover-foreground", "popover", 4.5],
  ["muted-foreground", "background", 4.5],
  ["muted-foreground", "card", 4.5],
  ["muted-foreground", "muted", 4.5],
  ["primary-foreground", "primary", 3.0],
  ["secondary-foreground", "secondary", 3.0],
  ["accent-foreground", "accent", 3.0],
  ["destructive-foreground", "destructive", 3.0],
  ["success", "card", 3.0],
  ["warning", "card", 3.0],
  ["destructive", "card", 3.0],
];

/** Collects every themed surface: default 21th (tokens.css) plus each skin file. */
type TokenVars = Record<string, string>;
type ThemedSurface = readonly [name: string, vars: TokenVars | null, file?: string];

function themedSurfaces(): ThemedSurface[] {
  const surfaces: ThemedSurface[] = [];
  const tokenBlocks = extractBlocks(readFileSync(join(STYLES_DIR, "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));
  if (tokenBlocks.has(":root")) surfaces.push(["21th light", tokenBlocks.get(":root") ?? null]);
  if (tokenBlocks.has(".dark")) surfaces.push(["21th dark", tokenBlocks.get(".dark") ?? null]);

  const skinsDir = join(STYLES_DIR, "skins");
  for (const file of readdirSync(skinsDir).sort()) {
    if (!file.endsWith(".css") || file === "index.css") continue;
    const id = file.replace(/\.css$/, "");
    const blocks = extractBlocks(readFileSync(join(skinsDir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));
    surfaces.push([`${id} light`, blocks.get(`[data-theme="${id}"]`) ?? null, join(skinsDir, file)]);
    surfaces.push([`${id} dark`, blocks.get(`[data-theme="${id}"].dark`) ?? null, join(skinsDir, file)]);
  }
  return surfaces;
}

describe("skin contrast", () => {
  const surfaces = themedSurfaces();

  it("finds both a light and a dark surface for the default and every skin", () => {
    for (const [name, vars] of surfaces) {
      expect(vars, `${name} token block missing`).not.toBeNull();
    }
    const names = surfaces.map(([name]) => name);
    for (const id of ["claude", "apple", "google", "tiktok", "nerv", "motion-fit", "minimalist", "goldentime", "vibecamp", "vercel"]) {
      expect(names).toContain(`${id} light`);
      expect(names).toContain(`${id} dark`);
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
    }
  });
});
