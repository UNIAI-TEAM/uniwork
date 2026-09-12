"use client";

import { useTranslation } from "react-i18next";
import type { AuditEvent } from "@uniwork/core/types";

/**
 * One row of the immutable log rendered inside the task timeline. The action
 * string stays lenient (ADR 0003), so an unknown action falls back to a
 * generic line instead of refusing to render.
 */
export function TaskActivityRow({ event }: { event: AuditEvent }) {
  const { t } = useTranslation();
  const fields = Object.keys(event.changes ?? {});
  const label =
    fields.length > 0
      ? t("tasks.detail.activity_changed_fields", { fields: fields.join(", ") })
      : t("tasks.detail.activity_generic");

  return (
    <div
      data-testid={`task-timeline-activity-${event.id}`}
      className="flex flex-wrap items-baseline gap-2 px-1 text-caption text-muted-foreground"
    >
      <span>{label}</span>
      <time dateTime={event.occurred_at}>{event.occurred_at}</time>
    </div>
  );
}
