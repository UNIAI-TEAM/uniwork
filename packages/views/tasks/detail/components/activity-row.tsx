"use client";

import { useTranslation } from "react-i18next";
import type { AuditEvent } from "@uniwork/core/types";

/**
 * Maps a raw `changes` key (a database column name) to the i18n key that
 * already carries its human label elsewhere in the product, so the
 * Vietnamese sentence never shows a snake_case column name. A key with no
 * mapping falls back to the raw key at render time — audit rows come from a
 * lenient wire contract (ADR 0003) and new columns appear over time; showing
 * the unknown key is ugly but honest, and dropping it would silently lose
 * information.
 */
const CHANGE_FIELD_LABEL_KEYS: Record<string, string> = {
  status: "tasks.status",
  priority: "tasks.priority",
  assignee_id: "tasks.assignee",
  due_date: "tasks.dueDate",
  description: "tasks.description",
  title: "tasks.taskTitle",
};

/**
 * One row of the immutable log rendered inside the task timeline. The action
 * string stays lenient (ADR 0003), so an unknown action falls back to a
 * generic line instead of refusing to render.
 */
export function TaskActivityRow({ event }: { event: AuditEvent }) {
  const { t } = useTranslation();
  const fields = Object.keys(event.changes ?? {});
  const fieldLabels = fields.map((key) => {
    const i18nKey = CHANGE_FIELD_LABEL_KEYS[key];
    return i18nKey ? t(i18nKey) : key;
  });
  const label =
    fieldLabels.length > 0
      ? t("tasks.detail.activity_changed_fields", {
          fields: fieldLabels.join(", "),
        })
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
