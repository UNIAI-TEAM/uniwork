"use client";
import { useTranslation } from "react-i18next";
import { activityLabelKey, useMeetingActivity } from "@uniwork/core/meetings";
import { useMembers } from "@uniwork/core/workspaces";
import { meetingLocale } from "./meeting-datetime";

export function MeetingActivityTimeline({ workspaceId, meetingId }: { workspaceId: string; meetingId: string }) {
  const { t, i18n } = useTranslation();
  const { data: items } = useMeetingActivity(meetingId);
  const { data: members } = useMembers(workspaceId);
  const nameOf = (id: string) => members?.find((m) => m.user_id === id)?.display_name ?? id;

  return (
    <section className="mt-6" aria-labelledby="activity-heading">
      <h2 id="activity-heading" className="mb-2 text-body font-semibold text-foreground">
        {t("meetings.activity")}
      </h2>
      {(items ?? []).length === 0 ? (
        <p className="text-label text-muted-foreground">{t("meetings.activityEmpty")}</p>
      ) : (
        <ol className="relative ml-1.5 space-y-3 border-l border-border pl-4">
          {(items ?? []).map((item) => {
            const from = item.from_state;
            const to = item.to_state;
            const showStates = Boolean(from && to && !from.startsWith("01") && !to.startsWith("01"));
            return (
              <li key={item.id} className="relative">
                <span aria-hidden className="absolute top-2 -left-[calc(1rem+3.5px)] size-1.5 rounded-full bg-faint-foreground" />
                <div className="text-body text-foreground">
                  <span className="font-medium">{nameOf(item.actor_id)}</span> {t(activityLabelKey(item.event_type))}
                </div>
                {showStates ? (
                  <div className="text-caption text-muted-foreground">
                    {t(`meetings.status_${from}`, { defaultValue: from })} → {t(`meetings.status_${to}`, { defaultValue: to })}
                  </div>
                ) : null}
                <div className="text-caption tabular-nums text-muted-foreground">
                  {new Date(item.occurred_at).toLocaleString(meetingLocale(i18n.language), { dateStyle: "short", timeStyle: "short" })}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
