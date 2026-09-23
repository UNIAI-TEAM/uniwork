"use client";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  msUntilScheduledEnd,
  SCHEDULE_WARN_1_MIN_MS,
  SCHEDULE_WARN_5_MIN_MS,
} from "@uniwork/core/meetings";

const TOAST_5_MIN = "meeting-schedule-5min";
const TOAST_1_MIN = "meeting-schedule-1min";
const TOAST_OVERTIME = "meeting-schedule-overtime";

/**
 * Live countdown inside the room: warn before ends_at, then stay in overtime.
 * The room closes only when status is ENDED or CANCELED (host or system), and
 * through `onClosed`: the room says why before anyone is sent away.
 */
export function useMeetingScheduleDeadline({
  endsAt,
  status,
  admitted,
  onClosed,
}: {
  endsAt?: string;
  status?: string;
  admitted: boolean;
  onClosed: (reason: "ended" | "canceled") => void;
}) {
  const { t } = useTranslation();
  const warnedRef = useRef(new Set<string>());
  const overtimeRef = useRef(false);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(() => {
    warnedRef.current = new Set();
    overtimeRef.current = false;
  }, [endsAt]);

  useEffect(() => {
    if (!admitted) return;
    if (status === "ENDED" || status === "CANCELED") {
      onClosedRef.current(status === "CANCELED" ? "canceled" : "ended");
      return;
    }
    if (!endsAt) return;

    const enterOvertime = () => {
      if (overtimeRef.current) return;
      overtimeRef.current = true;
      toast.dismiss(TOAST_5_MIN);
      toast.dismiss(TOAST_1_MIN);
      toast.info(t("meetings.scheduleOvertimeToast"), { id: TOAST_OVERTIME, duration: 8000 });
    };

    const tick = () => {
      const ms = msUntilScheduledEnd(endsAt);
      if (ms == null) return;
      if (ms <= 0) {
        enterOvertime();
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
  }, [endsAt, admitted, status, t]);
}
