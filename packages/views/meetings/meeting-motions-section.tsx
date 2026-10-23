"use client";
import { Vote } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingClerk } from "@uniwork/core/meetings/attendance";
import { useMeetingMotions } from "@uniwork/core/meetings/motions";
import type { Meeting } from "@uniwork/core/types";
import { PanelCard } from "../common/panel-card";
import { moduleTone } from "../layout/module-tones";
import { MeetingMotionsList } from "./meeting-motions-list";

/**
 * The detail page's vote card. Clerks draft items here before the meeting and
 * open or close them while it runs. Ballots are cast in the room, so everyone
 * else only sees progress and results. The card is hidden when there is
 * nothing to show: a meeting that is over with no items, or a non-clerk with
 * nothing opened yet.
 */
export function MeetingMotionsSection({ meeting, workspaceId }: { meeting: Meeting; workspaceId: string }) {
  const { t } = useTranslation();
  const { isClerk } = useMeetingClerk(meeting, workspaceId);
  const { data: motions } = useMeetingMotions(meeting.id);
  const list = motions ?? [];
  const over = meeting.status === "ENDED" || meeting.status === "CANCELED";
  if (over && list.length === 0) return null;
  if (!isClerk && !list.some((m) => m.status !== "DRAFT")) return null;
  return (
    <PanelCard
      id="motions-heading"
      icon={Vote}
      iconTone={moduleTone("meetings")}
      title={t("meetings.governance.motionsTitle")}
      flush
    >
      <MeetingMotionsList
        meeting={meeting}
        meetingId={meeting.id}
        workspaceId={workspaceId}
        canVote={false}
        density="compact"
      />
    </PanelCard>
  );
}
