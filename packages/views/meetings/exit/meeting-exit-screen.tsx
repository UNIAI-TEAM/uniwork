"use client";

import { CalendarCheck, UserX } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types";
import { formatMeetingWindow, meetingLocale } from "../meeting-datetime";
import { MeetingRoomAvatarsProvider } from "../meeting-room-avatars";
import { canRejoin, type ExitMedia, type RoomExit } from "./exit-model";
import { ExitHandedOver } from "./exit-handed-over";
import { ExitHostLeft } from "./exit-host-left";
import { BackToMeetingButton, ExitLeft } from "./exit-left";
import { ExitPresenceCard } from "./exit-presence-card";
import { ExitRating } from "./exit-rating";
import { ExitHeading, ExitMark, ExitShell } from "./exit-shell";
import { useRoomPresence } from "./use-room-presence";

export type MeetingExitScreenProps = {
  exit: RoomExit;
  meetingId: string;
  meeting?: Meeting;
  meetingTitle?: string;
  workspaceId?: string;
  guestMode?: boolean;
  meetingsHref?: string;
  /** The viewer's own participant id (from the join token): left out of "still in the room". */
  selfParticipantId: string | null;
  onRejoin: (media: ExitMedia) => void;
  onBackToMeeting: () => void;
  onEndForAll?: () => void;
  onExitChange?: (exit: RoomExit) => void;
};

/**
 * The screen that takes the room's place once someone is out of it (spec
 * 2026-10-27 §2). A viewer who left sees the meeting end from here: the
 * meeting record turning ENDED (meeting.ended refetches it) swaps their screen
 * for the ended one.
 */
export function MeetingExitScreen(props: MeetingExitScreenProps) {
  const { t, i18n } = useTranslation();
  const { exit, meeting, meetingId } = props;
  const endedMeanwhile = canRejoin(exit) && meeting?.status === "ENDED";
  const kind = endedMeanwhile ? "ended" : exit.kind;
  const presence = useRoomPresence(meetingId, {
    enabled: kind !== "ended" && kind !== "removed",
    selfParticipantId: props.selfParticipantId,
  });
  const title = meeting?.title ?? props.meetingTitle;
  const dateLine = meeting
    ? formatMeetingWindow(meeting.starts_at, meeting.ends_at, meetingLocale(i18n.language), t)
    : undefined;
  const rating = <ExitRating meetingId={meetingId} />;
  const presenceCard = <ExitPresenceCard people={presence.people} startedAt={meeting?.actual_start_at} />;

  let body;
  if (kind === "ended") {
    body = (
      <>
        <ExitMark className="bg-success-soft text-success-soft-foreground">
          <CalendarCheck aria-hidden />
        </ExitMark>
        <ExitHeading title={t("meetings.exit.ended.title")}>
          {title ? <p className="text-body-lg text-muted-foreground">{title}</p> : null}
        </ExitHeading>
        <BackToMeetingButton onClick={props.onBackToMeeting} />
        {rating}
      </>
    );
  } else if (kind === "removed") {
    body = (
      <>
        <ExitMark className="bg-destructive-soft text-destructive-soft-foreground">
          <UserX aria-hidden />
        </ExitMark>
        <ExitHeading title={t("meetings.exit.removed.title")} />
        <BackToMeetingButton onClick={props.onBackToMeeting} />
      </>
    );
  } else if (exit.kind === "leftHost" && meeting && props.workspaceId) {
    const { media } = exit;
    body = (
      <ExitHostLeft
        meeting={meeting}
        workspaceId={props.workspaceId}
        media={media}
        presence={presenceCard}
        participants={presence.all}
        onRejoin={() => props.onRejoin(media)}
        onEndForAll={props.onEndForAll}
        onHandedOver={(toUserId, toName) => props.onExitChange?.({ kind: "handedOver", media, toUserId, toName })}
        onRefreshPresence={presence.refetch}
      />
    );
  } else if (exit.kind === "handedOver") {
    const { media } = exit;
    body = (
      <ExitHandedOver
        toName={exit.toName}
        meetingTitle={title}
        presence={presenceCard}
        rating={rating}
        onRejoin={() => props.onRejoin(media)}
        onBackToMeeting={props.onBackToMeeting}
      />
    );
  } else if (canRejoin(exit)) {
    body = (
      <ExitLeft
        meetingTitle={title}
        media={exit.media}
        presence={presenceCard}
        rating={rating}
        onRejoin={() => props.onRejoin(exit.media)}
        onBackToMeeting={props.onBackToMeeting}
      />
    );
  }

  return (
    <MeetingRoomAvatarsProvider participants={presence.all} workspaceId={props.guestMode ? "" : (props.workspaceId ?? "")}>
      <ExitShell meetingsHref={props.guestMode ? undefined : props.meetingsHref} dateLine={dateLine}>
        {body}
      </ExitShell>
    </MeetingRoomAvatarsProvider>
  );
}
