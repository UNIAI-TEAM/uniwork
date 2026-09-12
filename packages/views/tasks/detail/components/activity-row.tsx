"use client";

import type { AuditEvent } from "@uniwork/core/types";
import {
  ActionIcon,
  ActorIcon,
  ChangeSummary,
  EventTime,
  shortId,
  useAuditLabels,
} from "../../../audit/event-presenter";

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
}: {
  event: AuditEvent;
  actorName?: string;
}) {
  const labels = useAuditLabels();
  return (
    <div
      data-testid={`task-timeline-activity-${event.id}`}
      className="flex flex-wrap items-center gap-2 px-1 text-caption text-muted-foreground"
    >
      <ActionIcon action={event.action} className="size-5" />
      <span className="inline-flex items-center gap-1 font-medium text-foreground">
        <ActorIcon
          kind={event.actor_kind}
          className="size-3.5 text-muted-foreground"
        />
        {actorName ?? shortId(event.actor_id)}
      </span>
      <span>{labels.action(event.action)}</span>
      <ChangeSummary event={event} empty={null} />
      <EventTime iso={event.occurred_at} className="ml-auto" />
    </div>
  );
}
