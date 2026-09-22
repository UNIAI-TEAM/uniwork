"use client";
import { ArrowLeft, MonitorSmartphone, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { MeetingGateScreen } from "./meeting-gate-screen";
import type { MediaDisconnectKind } from "./room-disconnect";

/**
 * The room lost its media connection. A replaced session (the same account
 * joined elsewhere) can take the room back from here — that re-join is what
 * moves the session, so it gets the primary action rather than no action.
 */
export function MeetingMediaError({
  kind,
  meetingTitle,
  guestMode = false,
  onRetry,
  onLeave,
}: {
  kind: MediaDisconnectKind;
  meetingTitle?: string;
  guestMode?: boolean;
  onRetry: () => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const replaced = kind === "replaced";
  return (
    <MeetingGateScreen
      icon={replaced ? MonitorSmartphone : WifiOff}
      tone={replaced ? "info" : "destructive"}
      alert={!replaced}
      meetingTitle={meetingTitle}
      title={t(replaced ? "meetings.sessionReplaced" : "meetings.connectionFailed")}
      description={t(
        replaced
          ? guestMode
            ? "meetings.sessionReplacedGuestHint"
            : "meetings.sessionReplacedHint"
          : "meetings.connectionFailedHint",
      )}
      actions={
        <>
          <Button onClick={onRetry}>{t(replaced ? "meetings.sessionReplacedUseHere" : "common.retry")}</Button>
          <Button variant="outline" onClick={onLeave}>
            <ArrowLeft aria-hidden />
            {t("meetings.leave")}
          </Button>
        </>
      }
    />
  );
}
