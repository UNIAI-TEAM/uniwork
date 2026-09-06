"use client";

import { useTranslation } from "react-i18next";
import { useResourceHistory } from "@uniwork/core/audit";
import { ActionIcon, ChangeSummary, EventTime, useAuditLabels } from "../audit/event-presenter";

/**
 * The task's own slice of the audit log.
 *
 * It reads the same immutable rows the organization-wide screen does, through
 * the workspace membership gate, so a team member sees what happened to their
 * work without being able to read the whole organization's activity. Nothing
 * here carries an IP address: a colleague's address is not activity.
 */
export function TaskActivity({ workspaceId, taskId }: { workspaceId: string; taskId: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit" });
  const labels = useAuditLabels();
  const { data, isError } = useResourceHistory(workspaceId, "task", taskId);

  if (isError) {
    return <p className="text-caption text-muted-foreground">{t("activity.error")}</p>;
  }
  const events = data ?? [];
  if (events.length === 0) {
    return <p className="text-caption text-muted-foreground">{t("activity.empty")}</p>;
  }
  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="flex items-start gap-2.5 text-caption">
          <ActionIcon action={event.action} className="size-6 [&>svg]:size-3" />
          <span className="min-w-0 flex-1 space-y-0.5">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-foreground">{labels.action(event.action)}</span>
              <EventTime iso={event.occurred_at} className="text-muted-foreground" />
            </span>
            <ChangeSummary event={event} max={3} empty={t("table.no_changes")} />
          </span>
        </li>
      ))}
    </ol>
  );
}
