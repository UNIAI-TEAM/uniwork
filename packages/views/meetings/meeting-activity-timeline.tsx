"use client";
import { useTranslation } from "react-i18next";
import { activityLabelKey, useMeetingActivity } from "@uniwork/core/meetings";
import { useMembers } from "@uniwork/core/workspaces";

export function MeetingActivityTimeline({ workspaceId, meetingId }: { workspaceId: string; meetingId: string }) {
  const { t } = useTranslation();
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
        <ol className="space-y-2">
          {(items ?? []).map((item) => {
            const from = item.from_state;
            const to = item.to_state;
            const showStates = Boolean(from && to && !from.startsWith("01") && !to.startsWith("01"));
            return (
              <li key={item.id} className="rounded-lg border border-border bg-surface px-3 py-2">
                <div className="text-body text-foreground">
                  {nameOf(item.actor_id)} {t(activityLabelKey(item.event_type))}
                </div>
                {showStates ? (
                  <div className="text-caption text-muted-foreground">
                    {from} → {to}
                  </div>
                ) : null}
                <div className="text-caption tabular-nums text-muted-foreground">
                  {new Date(item.occurred_at).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
