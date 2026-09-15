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
  /^task\.(comment_|reaction_|subscribed$|unsubscribed$)/;

export function isTimelineActivity(event: AuditEvent): boolean {
  return !DUPLICATED_BY_THE_TIMELINE.test(event.action);
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
  const valueLabel = (field: string, value: unknown): unknown => {
    if (typeof value !== "string") return value;
    if (field === "status") {
      return t(`tasks.status_${value}`, { defaultValue: value });
    }
    if (field === "priority") {
      return t(`tasks.priority_${value}`, { defaultValue: value });
    }
    return valueNames.get(value) ?? value;
  };
  const changes = changeEntries(event).slice(0, 2);
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
      <span>{labels.action(event.action)}</span>
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
                    className="text-muted-foreground line-through"
                  />
                  <ArrowRight aria-hidden className="size-3 shrink-0" />
                </>
              ) : null}
              <ChangeValue value={valueLabel(field, change.to)} />
            </span>
          ))}
          {changeEntries(event).length > changes.length ? (
            <span>+{changeEntries(event).length - changes.length}</span>
          ) : null}
        </span>
      ) : null}
      <EventTime iso={event.occurred_at} className="ml-auto" />
    </div>
  );
}
