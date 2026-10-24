"use client";
import { useState } from "react";
import { useOptionalNavigation } from "../../navigation";
import type { DetailTab } from "./detail-model";

/** `?section=` (push notifications, Ask UNI sources) → the tab that holds that section. */
export const SECTION_TAB: Record<string, DetailTab> = {
  summary: "overview",
  "action-items": "overview",
  transcript: "transcript",
  minutes: "minutes",
};

/**
 * The tab the page shows: `?tab=` when the page has it, else the tab of a
 * `?section=` deep link, else the transcript for a `?segment=` (a cited line),
 * else the first tab. A tab the viewer does not have falls through, so a
 * shared link never lands on a hidden tab. Null when the page has no tabs.
 */
export function resolveDetailTab(
  list: readonly DetailTab[],
  { tab, section, segment }: { tab?: string | null; section?: string | null; segment?: string | null },
): DetailTab | null {
  const pick = (t: string | null | undefined) => (t && (list as readonly string[]).includes(t) ? (t as DetailTab) : null);
  return pick(tab) ?? pick(section ? SECTION_TAB[section] : null) ?? pick(segment ? "transcript" : null) ?? list[0] ?? null;
}

/**
 * The page's tab in the URL (`?tab=`), so a reload or a shared link keeps it;
 * the calendar's docked panel keeps the same params in state instead (its URL
 * is the calendar's). `set` drops the one-shot deep-link params and may add
 * others (`finalize=1` for the minutes confirm, read back as `finalize`).
 */
export function useDetailTab(list: readonly DetailTab[], { urlBacked }: { urlBacked: boolean }) {
  const nav = useOptionalNavigation();
  const params = urlBacked ? nav?.searchParams : undefined;
  const [localQs, setLocalQs] = useState("");
  const search = params ?? new URLSearchParams(localQs);
  const current = resolveDetailTab(list, { tab: search.get("tab"), section: search.get("section"), segment: search.get("segment") });
  const commit = (next: URLSearchParams) => {
    const qs = next.toString();
    if (params && nav) nav.replace(qs ? `${nav.pathname}?${qs}` : nav.pathname);
    else setLocalQs(qs);
  };
  const set = (tab: DetailTab, extra: Record<string, string> = {}) => {
    const next = new URLSearchParams(search);
    for (const key of ["section", "segment", "finalize"]) next.delete(key);
    if (tab === list[0]) next.delete("tab");
    else next.set("tab", tab);
    for (const [key, value] of Object.entries(extra)) next.set(key, value);
    commit(next);
  };
  const finalize = search.get("finalize") === "1";
  const closeFinalize = () => {
    if (!finalize) return;
    const next = new URLSearchParams(search);
    next.delete("finalize");
    commit(next);
  };
  return { current, set, finalize, closeFinalize };
}
