"use client";
import { useTranslation } from "react-i18next";
import { useMeeting } from "@uniwork/core/meetings";
import { useMeetingCarriedOverItems } from "@uniwork/core/meetings/action-items";
import { useMeetingSummary } from "@uniwork/core/meetings/summary";
import { useDetail } from "../detail-context";
import { shortMeetingTitle } from "./carried-over-brief";
import { rsvpCounts } from "./rsvp-model";

/**
 * The host's strip before a follow-up (SeriesBrief): "2 người đã nhận lời ·
 * tiếp nối Giao ban tuần 43" over "4 việc chưa xong · 4 câu hỏi còn mở · chưa
 * chọn thư ký". Null for a meeting with no previous one in its series, or
 * until that meeting has loaded. Reads the same queries the series brief does.
 */
export function useSeriesStrip(on: boolean): { lead: string; rest: string; caption: string } | null {
  const { t } = useTranslation();
  const { meeting, participants, invitations } = useDetail();
  const previousId = on ? (meeting.previous_meeting_id ?? "") : "";
  const previous = useMeeting(previousId).data;
  const carried = useMeetingCarriedOverItems(previousId ? meeting.id : "").data?.items ?? [];
  const summary = useMeetingSummary(previousId);
  if (!previousId || !previous) return null;
  const tasks = carried.filter((item) => item.meeting.id === previousId).length;
  const questions = summary.isError ? 0 : (summary.data?.open_questions?.length ?? 0);
  const caption = [
    tasks > 0 ? t("meetings.detail.strip.seriesTasks", { count: tasks }) : "",
    questions > 0 ? t("meetings.detail.strip.seriesQuestions", { count: questions }) : "",
    participants.some((p) => p.is_secretary) ? "" : t("meetings.detail.strip.seriesNoSecretary"),
  ].filter(Boolean);
  return {
    lead: t("meetings.detail.strip.seriesAccepted", { count: rsvpCounts(participants, invitations).ACCEPTED }),
    rest: t("meetings.detail.strip.seriesFollows", { title: shortMeetingTitle(previous.title) }),
    caption: caption.join(" · "),
  };
}
