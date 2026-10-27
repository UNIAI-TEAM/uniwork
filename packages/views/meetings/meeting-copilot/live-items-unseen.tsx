"use client";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMeetingActionItems } from "@uniwork/core/meetings/action-items";

const NONE: ReadonlySet<string> = new Set();

/**
 * The action items the AI scribe wrote down during the meeting that this
 * viewer has not had on screen yet (UNI-1995 #21): pending LIVE items that
 * arrived after the viewer's first look at the list. `seeing` is true while
 * the UNI highlights show them (all kinds, or the tasks); it marks everything
 * there seen, so `count` (the tab badge) drops to 0 at once. `ids` holds the
 * unseen items' ids for the feed's "new" dots: frozen when `seeing` turns
 * true, so the rows that were news keep their dot for that whole visit, and
 * seen once it ends. An item that arrives while the viewer is looking is
 * seen at once (no dot). Per viewer and per visit, in memory: a reload
 * starts from what is there.
 */
export function useUnseenLiveItems(meetingId: string | undefined, seeing: boolean) {
  const { data } = useMeetingActionItems(meetingId ?? "");
  const live = useMemo(
    () => (data?.items ?? []).filter((i) => i.source === "LIVE" && i.status === "PENDING"),
    [data],
  );
  const liveIds = live.map((i) => i.id).join("\n");
  const [seen, setSeen] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!data) return;
    // The first answer is the baseline: what was there when the viewer came is not news.
    setSeen((prev) => (prev === null || seeing ? new Set(liveIds ? liveIds.split("\n") : []) : prev));
  }, [data, liveIds, seeing]);
  const waiting = seen ? live.filter((i) => !seen.has(i.id)) : [];
  // On the render `seeing` turns true, `seen` still predates it: what is unseen now is what the visit shows as new.
  const [visit, setVisit] = useState<{ seeing: boolean; news: ReadonlySet<string> }>({ seeing, news: NONE });
  if (visit.seeing !== seeing) setVisit({ seeing, news: seeing ? new Set(waiting.map((i) => i.id)) : NONE });
  const unseen = seeing ? [] : waiting;
  const latest = unseen.at(-1);
  const unseenKey = unseen.map((i) => i.id).join("\n");
  // Same set while the unseen ids stay the same, so a row list can memo on it.
  const away = useMemo<ReadonlySet<string>>(() => new Set(unseenKey ? unseenKey.split("\n") : []), [unseenKey]);
  return {
    count: unseen.length,
    latest: latest ? { id: latest.id, title: latest.title } : undefined,
    ids: seeing ? visit.news : away,
  };
}

/** Says, politely, what the scribe just wrote down while the UNI highlights are off screen. */
export function LiveItemsAnnouncer({
  count,
  latest,
  seeing,
}: {
  count: number;
  latest?: { id: string; title: string };
  seeing: boolean;
}) {
  const { t } = useTranslation();
  return (
    <p role="status" aria-live="polite" className="sr-only" data-testid="meeting-live-items-announcer">
      {!seeing && latest ? t("meetings.liveItemsNew", { count, title: latest.title }) : ""}
    </p>
  );
}
