"use client";
import { useTranslation } from "react-i18next";
import { useRecordings } from "@uniwork/core/meetings";
import { meetingLocale } from "./meeting-datetime";

export function MeetingRoomFilesTab({ meetingId }: { meetingId: string }) {
  const { t, i18n } = useTranslation();
  const { data: recordings, isLoading } = useRecordings(meetingId);
  const shared = (recordings ?? []).filter((r) => r.file_url);

  if (isLoading) {
    return <p className="text-label text-muted-foreground">{t("common.loading")}</p>;
  }

  if (shared.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
        <p className="text-label text-muted-foreground">{t("meetings.filesEmpty")}</p>
      </div>
    );
  }

  return (
    <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
      {shared.map((r) => (
        <li
          key={r.id}
          className="flex flex-col gap-1 rounded-xl border border-border bg-muted/20 px-3 py-2.5"
        >
          <span className="text-caption tabular-nums text-muted-foreground">
            {r.started_at
              ? new Date(r.started_at).toLocaleString(meetingLocale(i18n.language), {
                  dateStyle: "short",
                  timeStyle: "short",
                })
              : null}
          </span>
          <a
            href={r.file_url}
            target="_blank"
            rel="noreferrer"
            className="text-body font-medium text-brand underline-offset-4 hover:underline"
          >
            {t("meetings.openRecording")}
          </a>
        </li>
      ))}
    </ul>
  );
}
