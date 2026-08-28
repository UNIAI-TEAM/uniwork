"use client";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import { useJoinMeeting } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";

function lobbyMessage(t: (key: string) => string, decision: string | undefined, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "livekit_not_configured") return t("meetings.notConfigured");
    if (error.code === "meeting_not_started") return t("meetings.waitingForHost");
    return t("common.error");
  }
  switch (decision) {
    case "WAITING_FOR_HOST":
      return t("meetings.waitingForHost");
    case "WAITING_APPROVAL":
      return t("meetings.waitingApproval");
    case "DENY":
      return t("meetings.denied");
    default:
      return t("common.error");
  }
}

export function MeetingRoomView({
  meetingId,
  onLeave,
}: {
  meetingId: string;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const join = useJoinMeeting();

  useEffect(() => {
    join.mutate({ meetingId });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- join once per meeting
  }, [meetingId]);

  const decision = join.data;
  const admitted =
    decision?.decision === "ADMIT" && Boolean(decision.participant_token) && Boolean(decision.server_url);

  if (join.error || (decision && !admitted)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-body text-muted-foreground">{lobbyMessage(t, decision?.decision, join.error)}</p>
        <Button variant="outline" onClick={onLeave}>
          {t("meetings.leave")}
        </Button>
      </div>
    );
  }

  if (!admitted || !decision?.server_url || !decision.participant_token) {
    return <p className="p-6 text-muted-foreground">{t("common.loading")}</p>;
  }

  return (
    <div className="h-full" data-lk-theme="default">
      <LiveKitRoom
        serverUrl={decision.server_url}
        token={decision.participant_token}
        connect
        video
        audio
        onDisconnected={onLeave}
        style={{ height: "100%" }}
      >
        <VideoConference />
      </LiveKitRoom>
    </div>
  );
}
