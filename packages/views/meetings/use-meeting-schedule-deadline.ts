"use client";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  msUntilScheduledEnd,
  SCHEDULE_WARN_1_MIN_MS,
  SCHEDULE_WARN_5_MIN_MS,
  useEndMeeting,
} from "@uniwork/core/meetings";

const TOAST_5_MIN = "meeting-schedule-5min";
const TOAST_1_MIN = "meeting-schedule-1min";
const TOAST_ENDED = "meeting-schedule-ended";

/**
 * Live countdown inside the room: warn before ends_at, then leave (host ends
 * the meeting on the server so status flips to ENDED for everyone).
 */
export function useMeetingScheduleDeadline({
  endsAt,
  status,
  admitted,
  isHost,
  meetingId,
  workspaceId,
  onLeave,
}: {
  endsAt?: string;
  status?: string;
  admitted: boolean;
  isHost: boolean;
  meetingId: string;
  workspaceId?: string;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const end = useEndMeeting(workspaceId ?? "");
  const warnedRef = useRef(new Set<string>());
  const expiredRef = useRef(false);
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  useEffect(() => {
    warnedRef.current = new Set();
    expiredRef.current = false;
  }, [endsAt, meetingId]);

  useEffect(() => {
    if (!endsAt || !admitted) return;
    if (status === "ENDED" || status === "CANCELED") {
      onLeaveRef.current();
      return;
    }

    const expire = () => {
      if (expiredRef.current) return;
      expiredRef.current = true;
      toast.dismiss(TOAST_5_MIN);
      toast.dismiss(TOAST_1_MIN);
      toast.info(t("meetings.scheduleEndedAutoLeave"), { id: TOAST_ENDED, duration: 8000 });
      if (isHost && workspaceId && meetingId) {
        end.mutate(meetingId);
      }
      onLeaveRef.current();
    };

    const tick = () => {
      const ms = msUntilScheduledEnd(endsAt);
      if (ms == null) return;
      if (ms <= 0) {
        expire();
        return;
      }
      if (ms <= SCHEDULE_WARN_1_MIN_MS) {
        if (!warnedRef.current.has("1min")) {
          warnedRef.current.add("1min");
          toast.warning(t("meetings.scheduleEnding1Min"), { id: TOAST_1_MIN, duration: 10000 });
        }
        return;
      }
      if (ms <= SCHEDULE_WARN_5_MIN_MS && !warnedRef.current.has("5min")) {
        warnedRef.current.add("5min");
        toast.warning(t("meetings.scheduleEnding5Min"), { id: TOAST_5_MIN, duration: 10000 });
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(id);
      toast.dismiss(TOAST_5_MIN);
      toast.dismiss(TOAST_1_MIN);
    };
  }, [endsAt, admitted, status, isHost, meetingId, workspaceId, end, t]);
}
