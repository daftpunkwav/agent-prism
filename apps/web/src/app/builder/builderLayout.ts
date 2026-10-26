/**
 * @file builderLayout
 * @description The Builder shell's persisted three-column layout: side widths,
 *              collapse state, and the bounds that keep the chat column usable.
 *
 * Responsibilities:
 * - Read the remembered side widths / collapse state and clamp them
 * - Measure the width the visible columns share
 * - Clamp one side column to the bounds of the current column count
 *
 * Browser-side helpers: they read localStorage and the live layout, so they
 * run in the client only.
 */

/** Persisted three-column layout: side widths plus left/right collapse. */
export interface BuilderLayout {
  leftW: number;
  rightW: number;
  leftOpen: boolean;
  rightOpen: boolean;
}

/** localStorage key of the remembered layout. */
export const LAYOUT_KEY = "agentprism.builder.layout";

/** Factory layout: both side columns open at their default widths. */
export const DEFAULT_LAYOUT: BuilderLayout = { leftW: 320, rightW: 420, leftOpen: true, rightOpen: true };

/** Side-width bounds as fractions of the shell's column area: two visible
 * columns allow [1/3, 2/3] per side, three visible columns [1/4, 1/2]. */
const TWO_COL_BOUNDS = { minFrac: 1 / 3, maxFrac: 2 / 3 };
const THREE_COL_BOUNDS = { minFrac: 0.25, maxFrac: 0.5 };

/** Live width of the area the three columns share (shell content minus the
 * two grid gaps); 0 when unavailable (SSR prerender, unmounted mid-gesture). */
export function shellColumnWidth(): number {
  if (typeof document === "undefined") return 0;
  const shell = document.querySelector(".builder-shell");
  if (!(shell instanceof HTMLElement)) return 0;
  const style = getComputedStyle(shell);
  const gap = Number.parseFloat(style.columnGap);
  const width =
    shell.clientWidth -
    Number.parseFloat(style.paddingLeft) -
    Number.parseFloat(style.paddingRight) -
    (Number.isFinite(gap) ? gap * 2 : 0);
  return Number.isFinite(width) && width > 0 ? width : 0;
}

/**
 * Clamp one side column to the active bounds. With three columns the chat
 * column also keeps its minimum share, so this side is additionally capped by
 * the other side's width; the cap never drops below the minimum.
 */
export function clampSideW(width: number, otherW: number, threeCols: boolean, total: number): number {
  if (!Number.isFinite(width) || total <= 0) return width;
  const { minFrac, maxFrac } = threeCols ? THREE_COL_BOUNDS : TWO_COL_BOUNDS;
  let hi = maxFrac * total;
  if (threeCols) hi = Math.max(minFrac * total, Math.min(hi, (1 - minFrac) * total - otherW));
  return Math.round(Math.min(hi, Math.max(minFrac * total, width)));
}

/** Clamp open side widths to the bounds of the given visibility; idempotent. */
export function clampLayout(prev: BuilderLayout): BuilderLayout {
  const total = shellColumnWidth();
  if (total <= 0) return prev;
  const threeCols = prev.leftOpen && prev.rightOpen;
  const leftW = prev.leftOpen ? clampSideW(prev.leftW, prev.rightW, threeCols, total) : prev.leftW;
  const rightW = prev.rightOpen ? clampSideW(prev.rightW, leftW, threeCols, total) : prev.rightW;
  if (leftW === prev.leftW && rightW === prev.rightW) return prev;
  return { ...prev, leftW, rightW };
}

/** The remembered layout, clamped to the bounds of the current column area. */
export function loadLayout(): BuilderLayout {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(LAYOUT_KEY) : null;
    if (!raw) return clampLayout(DEFAULT_LAYOUT);
    const parsed = JSON.parse(raw) as Partial<BuilderLayout>;
    return clampLayout({
      leftW: typeof parsed.leftW === "number" && Number.isFinite(parsed.leftW) ? parsed.leftW : DEFAULT_LAYOUT.leftW,
      rightW: typeof parsed.rightW === "number" && Number.isFinite(parsed.rightW) ? parsed.rightW : DEFAULT_LAYOUT.rightW,
      leftOpen: parsed.leftOpen ?? true,
      rightOpen: parsed.rightOpen ?? true,
    });
  } catch {
    return DEFAULT_LAYOUT;
  }
}
