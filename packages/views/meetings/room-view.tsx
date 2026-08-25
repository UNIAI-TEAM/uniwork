"use client";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import { useMeetingToken } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";

export function MeetingRoomView({
  meetingId,
  onLeave,
}: {
  meetingId: string;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const tokenReq = useMeetingToken();

  useEffect(() => {
    tokenReq.mutate(meetingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy khi đổi meeting
  }, [meetingId]);

  if (tokenReq.error) {
    const msg =
      tokenReq.error instanceof ApiError && tokenReq.error.code === "livekit_not_configured"
        ? t("meetings.notConfigured")
        : t("common.error");
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-secondary">{msg}</p>
        <Button variant="secondary" onClick={onLeave}>
          {t("meetings.leave")}
        </Button>
      </div>
    );
  }

  if (!tokenReq.data) {
    return <p className="p-6 text-secondary">{t("common.loading")}</p>;
  }

  return (
    <div className="h-full" data-lk-theme="default">
      <LiveKitRoom
        serverUrl={tokenReq.data.url}
        token={tokenReq.data.token}
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
