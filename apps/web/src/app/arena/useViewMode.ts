/**
 * @file useViewMode
 * @description Results-stage view mode state with localStorage persistence.
 *
 * Responsibilities:
 * - Hold the active results view mode id
 * - Hold per-mode page sizes: the default view's visible-column cap and the
 *   paged view's columns-per-page (both 1–4)
 * - Persist to localStorage; corrupted storage falls back to defaults
 */

"use client";

import { useCallback, useSyncExternalStore } from "react";

/** All results-stage view modes. The default view keeps the classic column grid. */
export const VIEW_MODES = ["all", "paged", "podium", "stats", "gallery", "timeline"] as const;

export type ViewMode = (typeof VIEW_MODES)[number];

/** Narrow a string to a ViewMode; undefined when it is not a known mode id. */
export function parseViewMode(raw: string): ViewMode | undefined {
  return (VIEW_MODES as readonly string[]).includes(raw) ? (raw as ViewMode) : undefined;
}

/** Allowed per-page counts: "at most N columns on one page" (1–4). */
export const PAGE_SIZE_OPTIONS = [1, 2, 3, 4] as const;

export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export type ViewPrefs = {
  mode: ViewMode;
  /** Default view: max columns visible on one screen; the rest horizontal-scrolls. */
  allPageSize: PageSize;
  /** Paged view: columns rendered per page behind the pager controls. */
  pagedPageSize: PageSize;
};

const STORAGE_KEY = "agentprism.arena.viewMode.v1";

export const DEFAULT_PREFS: ViewPrefs = { mode: "all", allPageSize: 4, pagedPageSize: 2 };

/** Narrows a raw number to an allowed page size; null when out of set. */
function parsePageSize(raw: unknown): PageSize | null {
  return PAGE_SIZE_OPTIONS.find((size) => size === raw) ?? null;
}

/** Parses raw prefs; null when absent or corrupted (unknown modes reject too). */
function parsePrefs(raw: string | null): ViewPrefs | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      mode?: unknown;
      allPageSize?: unknown;
      pagedPageSize?: unknown;
      /** Legacy v1 field: a single shared page size. */
      pageSize?: unknown;
    };
    const mode = typeof parsed.mode === "string" ? parseViewMode(parsed.mode) : undefined;
    if (mode === undefined) return null;
    // Legacy single field seeds the default view's cap; unknown values fall to defaults.
    const legacy = parsePageSize(parsed.pageSize);
    const allPageSize = parsePageSize(parsed.allPageSize) ?? legacy ?? DEFAULT_PREFS.allPageSize;
    const pagedPageSize = parsePageSize(parsed.pagedPageSize) ?? DEFAULT_PREFS.pagedPageSize;
    return { mode, allPageSize, pagedPageSize };
  } catch {
    return null;
  }
}

/** localStorage snapshot cache: getSnapshot must return a stable identity per store state. */
let cachedSnapshot: ViewPrefs = DEFAULT_PREFS;
let cachedRaw: string | null = null;
/** In-session override for when localStorage writes fail (private mode / quota):
 *  the choice applies now but resets on the next visit. */
let memoryPrefs: ViewPrefs | null = null;

/** Reads and caches the stored prefs so identity stays stable between renders. */
function snapshot(): ViewPrefs {
  let raw: string | null = null;
  try {
    raw = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSnapshot = parsePrefs(raw) ?? DEFAULT_PREFS;
    // Another tab (or a cleared store) changed the raw value; the override no
    // longer matches what was written, so stored prefs win again.
    memoryPrefs = null;
  }
  return memoryPrefs ?? cachedSnapshot;
}

/** Writes through to localStorage and notifies subscribers (same tab + other tabs). */
function store(prefs: ViewPrefs): void {
  memoryPrefs = prefs;
  try {
    const serialized = JSON.stringify(prefs);
    window.localStorage.setItem(STORAGE_KEY, serialized);
    // getItem returns exactly the written string, so it can seed the cache
    // directly instead of re-reading on the next snapshot.
    cachedRaw = serialized;
  } catch {
    // Private mode / quota: keep memoryPrefs active; preferences reset next visit.
  }
  emitChange();
}

/** Server snapshot: SSR markup always renders the defaults. */
const SERVER_PREFS: ViewPrefs = DEFAULT_PREFS;

const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Cross-tab sync: storage events fire only for other tabs, same-tab writes
  // notify through store() directly.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** View mode state + persistence: mode and per-mode page sizes, restored across visits. */
export function useViewMode(): {
  prefs: ViewPrefs;
  setMode: (mode: ViewMode) => void;
  setAllPageSize: (size: PageSize) => void;
  setPagedPageSize: (size: PageSize) => void;
} {
  const prefs = useSyncExternalStore(subscribe, snapshot, () => SERVER_PREFS);

  const setMode = useCallback((mode: ViewMode) => {
    if (snapshot().mode !== mode) store({ ...snapshot(), mode });
  }, []);

  const setAllPageSize = useCallback((allPageSize: PageSize) => {
    if (snapshot().allPageSize !== allPageSize) store({ ...snapshot(), allPageSize });
  }, []);

  const setPagedPageSize = useCallback((pagedPageSize: PageSize) => {
    if (snapshot().pagedPageSize !== pagedPageSize) store({ ...snapshot(), pagedPageSize });
  }, []);

  return { prefs, setMode, setAllPageSize, setPagedPageSize };
}
