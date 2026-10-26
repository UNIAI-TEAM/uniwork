"use client";

import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AuditEvent } from "@uniwork/core/types";
import {
  ActionIcon,
  changeEntries,
  ChangeValue,
  EventTime,
  shortId,
  useAuditLabels,
} from "../../../audit/event-presenter";
import { TaskActorAvatar } from "./task-actor-avatar";

/**
 * Actions the task timeline deliberately leaves out, because the thing they
 * describe is already sitting in the same column: a comment action duplicates
 * the comment card next to it, a reaction action duplicates the reaction chips
 * on that card, and subscribe/unsubscribe is a private preference whose state
 * the header button already shows. Everything else — including an action from
 * a newer server the UI has never seen — renders, because the wire contract
 * for `action` is lenient (ADR 0003) and hiding an unknown event would be a
 * worse lie than labelling it with its raw name.
 */
const DUPLICATED_BY_THE_TIMELINE =
  /^(?:task\.(?:comment_|reaction_|subscribed$|unsubscribed$)|comment\.reaction_)/;

export function isTimelineActivity(event: AuditEvent): boolean {
  return !DUPLICATED_BY_THE_TIMELINE.test(event.action);
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/** The AI app (ADR 0033) or Ask UNI (ADR 0044) a change came through, or "" when none or malformed. */
function viaClient(event: AuditEvent, askUni: string): string {
  const via = event.metadata.via;
  if (typeof via !== "object" || via === null) return "";
  const { client_name: name, kind } = via as Record<string, unknown>;
  if (kind === "ask_uni") return askUni;
  return typeof name === "string" ? name : "";
}

function extractDriveFileName(event: AuditEvent): string {
  const raw = event.metadata?.drive_file_name;
  return typeof raw === "string" ? raw.trim() : "";
}

function resolveActionLabel(
  event: AuditEvent,
  labels: { action: (action: string) => string },
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const fileName = extractDriveFileName(event);
  if (event.action === "task.drive_file_linked") {
    return fileName
      ? t("tasks.detail.activity_drive_file_linked", { name: fileName })
      : labels.action(event.action);
  }
  if (event.action === "task.drive_file_unlinked") {
    return fileName
      ? t("tasks.detail.activity_drive_file_unlinked", { name: fileName })
      : labels.action(event.action);
  }
  if (
    event.action === "task.created" &&
    event.metadata?.source === "drive_task_proposal"
  ) {
    return fileName
      ? t("tasks.detail.activity_created_from_drive_proposal", { name: fileName })
      : t("tasks.detail.activity_created_from_drive_proposal_unnamed");
  }
  return labels.action(event.action);
}

/**
 * One row of the immutable log rendered inside the task timeline, told with
 * the same words and the same glyphs as the organization-wide audit log: the
 * shared presenter translates the action, renders the diff and the time.
 */
export function TaskActivityRow({
  event,
  actorName,
  actorAvatarUrl,
  valueNames = new Map(),
}: {
  event: AuditEvent;
  actorName?: string;
  actorAvatarUrl?: string;
  valueNames?: Map<string, string>;
}) {
  const { t } = useTranslation();
  const labels = useAuditLabels();
  // Ids (assignee, project) read as the names the caller resolved; enums go
  // through the shared audit words.
  const valueLabel = (field: string, value: unknown): unknown =>
    typeof value === "string" && valueNames.has(value)
      ? valueNames.get(value)
      : labels.value(field, value, "task");
  // Position is an internal ordering coordinate, not a meaningful task-detail
  // change. Keep it in the immutable audit event for the organization log,
  // but omit it from this resource-local timeline and its remaining-field count.
  // On creation the assignee's kind only restates the assignee, and a field
  // created empty is not news ("Hạn: Không có").
  const created = event.action === "task.created";
  const timelineChanges = changeEntries(event).filter(
    ([field, change]) =>
      field !== "position" &&
      !(created && (field === "assignee_kind" || isEmpty(change.to))),
  );
  const changes = timelineChanges.slice(0, 2);
  const via = viaClient(event, t("ai.title"));
  return (
    <div
      data-testid={`task-timeline-activity-${event.id}`}
      className="flex flex-wrap items-center gap-2 px-1 text-caption text-muted-foreground"
    >
      <ActionIcon action={event.action} className="size-5" />
      <span className="inline-flex items-center gap-1 font-medium text-foreground">
        <TaskActorAvatar
          name={actorName ?? shortId(event.actor_id)}
          avatarUrl={actorAvatarUrl}
          kind={event.actor_kind}
        />
        {actorName ?? shortId(event.actor_id)}
      </span>
      {via ? <span>{t("tasks.detail.activity_via", { client: via })}</span> : null}
      <span>{resolveActionLabel(event, labels, t)}</span>
      {changes.length > 0 ? (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {changes.map(([field, change]) => (
            <span
              key={field}
              className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 whitespace-nowrap"
            >
              <span className="font-medium">{labels.field(field)}</span>
              {change.from !== null && change.from !== undefined && change.from !== "" ? (
                <>
                  <ChangeValue
                    value={valueLabel(field, change.from)}
                    className="text-muted-foreground"
                  />
                  <ArrowRight aria-hidden className="size-3 shrink-0" />
                </>
              ) : null}
              <ChangeValue value={valueLabel(field, change.to)} />
            </span>
          ))}
          {timelineChanges.length > changes.length ? (
            <span>
              {t("settings.audit.table.more_fields", {
                count: timelineChanges.length - changes.length,
              })}
            </span>
          ) : null}
        </span>
      ) : null}
      <EventTime iso={event.occurred_at} className="ml-auto" />
    </div>
  );
}
