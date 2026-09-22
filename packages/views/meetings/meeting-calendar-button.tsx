"use client";
import { CalendarPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMeetingCalendar } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { toastApiError } from "../toast-api-error";

/** "Họp giao ban Đội Sản phẩm" → "hop-giao-ban-doi-san-pham.ics"; an unusable title falls back to the id. */
export function meetingIcsFileName(title: string, meetingId: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${slug || `meeting-${meetingId}`}.ics`;
}

/** Browser download of an .ics the API already authenticated for us. */
function downloadCalendar(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function MeetingCalendarButton({
  meetingId,
  title,
  className,
}: {
  meetingId: string;
  title: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const cal = useMeetingCalendar();
  return (
    <Button
      type="button"
      size="lg"
      variant="ghost"
      className={className}
      disabled={cal.isPending}
      onClick={() =>
        cal.mutate(meetingId, {
          onSuccess: (ics) => {
            const filename = meetingIcsFileName(title, meetingId);
            downloadCalendar(filename, ics);
            toast.success(t("meetings.calendarDownloaded", { file: filename }));
          },
          onError: (err) => toastApiError(err, t("common.error")),
        })
      }
    >
      <CalendarPlus aria-hidden />
      {t("meetings.addToCalendar")}
    </Button>
  );
}
