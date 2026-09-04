"use client";

import { useTranslation } from "react-i18next";
import { useResourceHistory } from "@uniwork/core/audit";
import type { AuditEvent } from "@uniwork/core/types";
import { Badge } from "@uniwork/ui/components/ui/badge";

/**
 * The task's own slice of the audit log.
 *
 * It reads the same immutable rows the organization-wide screen does, through
 * the workspace membership gate, so a team member sees what happened to their
 * work without being able to read the whole organization's activity. Nothing
 * here carries an IP address: a colleague's address is not activity.
 */
export function TaskActivity({ workspaceId, taskId }: { workspaceId: string; taskId: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit.activity" });
  const { data, isError } = useResourceHistory(workspaceId, "task", taskId);

  if (isError) {
    return <p className="text-caption text-muted-foreground">{t("error")}</p>;
  }
  const events = data ?? [];
  if (events.length === 0) {
    return <p className="text-caption text-muted-foreground">{t("empty")}</p>;
  }
  return (
    <ol className="space-y-2">
      {events.map((event) => (
        <li key={event.id} className="flex flex-wrap items-baseline gap-2 text-caption">
          <time dateTime={event.occurred_at} className="text-muted-foreground">
            {new Date(event.occurred_at).toLocaleString()}
          </time>
          <Badge variant="secondary">{event.action}</Badge>
          <span className="text-muted-foreground">{changedFields(event)}</span>
        </li>
      ))}
    </ol>
  );
}

function changedFields(event: AuditEvent): string {
  return Object.keys(event.changes ?? {}).join(", ");
}
