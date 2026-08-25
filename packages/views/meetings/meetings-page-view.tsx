"use client";
import { CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";
import { splitMeetings, useMeetings } from "@uniwork/core/meetings";
import { useWorkspaceEvents } from "@uniwork/core/realtime";
import type { Meeting } from "@uniwork/core/types";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import { NewMeetingDialog } from "./new-meeting-dialog";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

function MeetingRow({ meeting, onOpen }: { meeting: Meeting; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(meeting.id)}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-2.5 text-left transition-colors hover:border-input"
    >
      <span className="truncate text-body text-foreground">{meeting.title}</span>
      <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
        {fmt(meeting.starts_at)} – {fmt(meeting.ends_at)}
      </span>
    </button>
  );
}

export function MeetingsPageView({
  workspaceId,
  onOpen,
}: {
  workspaceId: string;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  useWorkspaceEvents(workspaceId);
  const { data: meetings, isFetched } = useMeetings(workspaceId);
  const { upcoming, past } = splitMeetings(meetings ?? [], new Date());
  const isEmpty = isFetched && (meetings?.length ?? 0) === 0;

  return (
    <div className="flex h-full flex-col">
      <CollectionPageHeader
        icon={CalendarDays}
        title={t("meetings.title")}
        count={meetings?.length}
        actions={<NewMeetingDialog workspaceId={workspaceId} />}
      />
      {isEmpty ? (
        <CollectionPageState
          icon={CalendarDays}
          title={t("meetings.empty_title")}
          description={t("meetings.empty_description")}
        />
      ) : (
        <div className="mx-auto w-full max-w-2xl flex-1 space-y-6 overflow-auto p-6">
          <section>
            <h2 className="mb-2 text-label font-medium text-muted-foreground">{t("meetings.upcoming")}</h2>
            <div className="space-y-2">
              {upcoming.length === 0 && (
                <p className="text-label text-muted-foreground">{t("common.empty")}</p>
              )}
              {upcoming.map((m) => (
                <MeetingRow key={m.id} meeting={m} onOpen={onOpen} />
              ))}
            </div>
          </section>
          {past.length > 0 && (
            <section>
              <h2 className="mb-2 text-label font-medium text-muted-foreground">{t("meetings.past")}</h2>
              <div className="space-y-2">
                {past.map((m) => (
                  <MeetingRow key={m.id} meeting={m} onOpen={onOpen} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
