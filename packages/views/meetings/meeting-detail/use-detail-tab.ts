"use client";
import { useCallback, useState } from "react";
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
 * the calendar's docked panel keeps it in state instead (its URL is the
 * calendar's). `set` drops the one-shot deep-link params and may add others
 * (`finalize=1` for the minutes confirm).
 */
export function useDetailTab(list: readonly DetailTab[], { urlBacked }: { urlBacked: boolean }) {
  const nav = useOptionalNavigation();
  const params = urlBacked ? nav?.searchParams : undefined;
  const [local, setLocal] = useState<DetailTab | null>(null);
  const current = resolveDetailTab(list, {
    tab: params ? params.get("tab") : local,
    section: params?.get("section"),
    segment: params?.get("segment"),
  });
  const set = useCallback(
    (tab: DetailTab, extra: Record<string, string> = {}) => {
      if (!params || !nav) {
        setLocal(tab);
        return;
      }
      const next = new URLSearchParams(params);
      for (const key of ["section", "segment", "finalize"]) next.delete(key);
      if (tab === list[0]) next.delete("tab");
      else next.set("tab", tab);
      for (const [key, value] of Object.entries(extra)) next.set(key, value);
      const qs = next.toString();
      nav.replace(qs ? `${nav.pathname}?${qs}` : nav.pathname);
    },
    [list, nav, params],
  );
  return { current, set };
}
