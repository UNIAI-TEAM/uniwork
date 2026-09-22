"use client";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { MediaDisconnectKind } from "./room-disconnect";

/**
 * The room lost its media connection. A replaced session (the same account
 * joined elsewhere) can take the room back from here — that re-join is what
 * moves the session, so it gets the primary action rather than no action.
 */
export function MeetingMediaError({
  kind,
  onRetry,
  onLeave,
}: {
  kind: MediaDisconnectKind;
  onRetry: () => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const replaced = kind === "replaced";
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="max-w-md text-pretty text-body text-foreground">
        {t(replaced ? "meetings.sessionReplaced" : "meetings.connectionFailed")}
      </p>
      <p className="max-w-md text-pretty text-caption text-muted-foreground">
        {t(replaced ? "meetings.sessionReplacedHint" : "meetings.connectionFailedHint")}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={onRetry}>{t(replaced ? "meetings.sessionReplacedUseHere" : "common.retry")}</Button>
        <Button variant="outline" onClick={onLeave}>
          {t("meetings.leave")}
        </Button>
      </div>
    </div>
  );
}
