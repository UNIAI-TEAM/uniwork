"use client";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMeetingActionItems } from "@uniwork/core/meetings/action-items";

/**
 * The action items the AI scribe wrote down during the meeting that this
 * viewer has not had on screen yet (UNI-1995 #21): pending LIVE items that
 * arrived after the viewer's first look at the list. `seeing` is true while
 * the UNI panel's Việc section is on screen; it marks everything there seen.
 * Per viewer and per visit, in memory: a reload starts from what is there.
 */
export function useUnseenLiveItems(meetingId: string | undefined, seeing: boolean) {
  const { data } = useMeetingActionItems(meetingId ?? "");
  const live = useMemo(
    () => (data?.items ?? []).filter((i) => i.source === "LIVE" && i.status === "PENDING"),
    [data],
  );
  const ids = live.map((i) => i.id).join("\n");
  const [seen, setSeen] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!data) return;
    // The first answer is the baseline: what was there when the viewer came is not news.
    setSeen((prev) => (prev === null || seeing ? new Set(ids ? ids.split("\n") : []) : prev));
  }, [data, ids, seeing]);
  const unseen = seen && !seeing ? live.filter((i) => !seen.has(i.id)) : [];
  const latest = unseen.at(-1);
  return { count: unseen.length, latest: latest ? { id: latest.id, title: latest.title } : undefined };
}

/** Says, politely, what the scribe just wrote down while the Việc section is off screen. */
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
