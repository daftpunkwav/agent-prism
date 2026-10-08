/**
 * @file useViewMode
 * @description Results-stage view mode state with localStorage persistence.
 *
 * Responsibilities:
 * - Hold the active results view mode id
 * - Hold the max columns per page for the default "all" view (3–6)
 * - Persist both to localStorage; corrupted storage falls back to defaults
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

/** Allowed page sizes for the default view's "max columns per page" control. */
export const PAGE_SIZE_OPTIONS = [3, 4, 5, 6] as const;

export type ViewPrefs = {
  mode: ViewMode;
  /** Default view only: cap on simultaneously rendered columns; the rest horizontal-scrolls. */
  pageSize: (typeof PAGE_SIZE_OPTIONS)[number];
};

const STORAGE_KEY = "agentprism.arena.viewMode.v1";

export const DEFAULT_PREFS: ViewPrefs = { mode: "all", pageSize: 4 };

/** Parses raw prefs; null when absent or corrupted (unknown modes/sizes reject too). */
function parsePrefs(raw: string | null): ViewPrefs | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { mode?: unknown; pageSize?: unknown };
    const mode = typeof parsed.mode === "string" ? parseViewMode(parsed.mode) : undefined;
    if (mode === undefined) return null;
    const pageSize = PAGE_SIZE_OPTIONS.find((size) => size === parsed.pageSize) ?? DEFAULT_PREFS.pageSize;
    return { mode, pageSize };
  } catch {
    return null;
  }
}

/** localStorage snapshot cache: getSnapshot must return a stable identity per store state. */
let cachedSnapshot: ViewPrefs = DEFAULT_PREFS;
let cachedRaw: string | null = null;

/** Reads and caches the stored prefs so identity stays stable between renders. */
function snapshot(): ViewPrefs {
  let raw: string | null = null;
  try {
    raw = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw === cachedRaw) return cachedSnapshot;
  cachedRaw = raw;
  cachedSnapshot = parsePrefs(raw) ?? DEFAULT_PREFS;
  return cachedSnapshot;
}

/** Writes through to localStorage and notifies subscribers (same tab + other tabs). */
function store(prefs: ViewPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode / quota: preferences simply reset next visit.
  }
  cachedRaw = null;
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

/** View mode state + persistence: mode and default-view page size, restored across visits. */
export function useViewMode(): {
  prefs: ViewPrefs;
  setMode: (mode: ViewMode) => void;
  setPageSize: (pageSize: ViewPrefs["pageSize"]) => void;
} {
  const prefs = useSyncExternalStore(subscribe, snapshot, () => SERVER_PREFS);

  const setMode = useCallback((mode: ViewMode) => {
    if (snapshot().mode !== mode) store({ ...snapshot(), mode });
  }, []);

  const setPageSize = useCallback((pageSize: ViewPrefs["pageSize"]) => {
    if (snapshot().pageSize !== pageSize) store({ ...snapshot(), pageSize });
  }, []);

  return { prefs, setMode, setPageSize };
}
