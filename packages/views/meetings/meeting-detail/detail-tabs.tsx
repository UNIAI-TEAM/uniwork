"use client";
import { useTranslation } from "react-i18next";
import { useNotes, useOlderTranscript, useTranscript } from "@uniwork/core/meetings";
import { useMeetingMinutes } from "@uniwork/core/meetings/minutes";
import { useFullTranscript } from "@uniwork/core/meetings/transcript";
import { MeetingUnderlineTabs } from "../meeting-underline-tabs";
import { useDetail } from "./detail-context";
import type { DetailTab } from "./detail-model";
import { CountPill } from "./ui/count-pill";

export const detailPanelId = (tab: DetailTab) => `meeting-tab-${tab}`;

/** Lines heard so far: the whole run once ended, the live feed only once no older page is left (no guessed totals). */
function useTranscriptCount(enabled: boolean): number | null {
  const { meeting, displayStatus } = useDetail();
  const ended = displayStatus === "ENDED";
  const full = useFullTranscript(meeting.id, enabled && ended);
  const live = useTranscript(meeting.id, enabled && !ended);
  const { hasOlder } = useOlderTranscript(meeting.id, enabled && !ended);
  if (!enabled) return null;
  if (ended) return full.data ? full.data.length : null;
  return live.data && !hasOlder ? live.data.length : null;
}

/**
 * The page tabs (kit `.tabs`): ended Tổng quan · Lời thoại n · Biên bản
 * Nháp/Đã chốt; live Ghi chú chung n · Lời thoại n. The list comes from
 * `visibleTabs`; none before the meeting, after a miss or cancel, or for an outsider.
 */
export function DetailTabs() {
  const { t } = useTranslation();
  // The list already leaves out Lời thoại when the scribe was off and heard nothing (MeetingDetailView).
  const { meeting, tabs } = useDetail();
  const transcriptCount = useTranscriptCount(tabs.list.includes("transcript"));
  const { data: minutes } = useMeetingMinutes(meeting.id, tabs.list.includes("minutes"));
  // No minutes yet (AfterAIStates c1–c3): no Biên bản tab, unless it is the open one: a clerk
  // opens it from the rail's "Biên bản" row to create them, so the bar and the panel still agree.
  const list = minutes || tabs.current === "minutes" ? tabs.list : tabs.list.filter((tab) => tab !== "minutes");
  const { data: notes } = useNotes(list.includes("notes") ? meeting.id : "");
  if (list.length === 0 || !tabs.current) return null;
  const badge = (tab: DetailTab) => {
    if (tab === "transcript" && transcriptCount) return <CountPill>{transcriptCount}</CountPill>;
    if (tab === "notes" && notes?.length) return <CountPill>{notes.length}</CountPill>;
    if (tab === "minutes" && minutes) {
      return minutes.finalized ? (
        <CountPill tone="success">{t("meetings.detail.tabs.final")}</CountPill>
      ) : (
        <CountPill tone="warning">{t("meetings.detail.tabs.draft")}</CountPill>
      );
    }
    return null;
  };
  return (
    <MeetingUnderlineTabs
      size="page"
      tabs={list}
      value={tabs.current}
      onChange={tabs.set}
      label={(tab) => t(`meetings.detail.tabs.${tab}`)}
      badge={badge}
      panelId={detailPanelId}
      ariaLabel={t("meetings.detail.tabs.aria")}
    />
  );
}
