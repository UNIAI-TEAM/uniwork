import type { QueryClient } from "@tanstack/react-query";
import type { MeetingActionItems } from "../api/endpoints/meeting-action-items";
import { meetingKeys } from "../meetings/hooks";

type Keys = (readonly unknown[])[];

/**
 * The meeting keys a task lifecycle frame invalidates. Split out of
 * use-realtime-sync (max-lines) with the follow-through frames below.
 */
export function meetingTaskFrameKeys(qc: QueryClient, type: string, taskId: string | undefined): Keys {
  const keys: Keys = [];
  // A converted action item shows its task's state; only cached lists that
  // hold this task refetch.
  if ((type === "task.updated" || type === "task.deleted") && taskId) {
    for (const [key, data] of qc.getQueriesData<MeetingActionItems>({ queryKey: meetingKeys.actionItemsRoot })) {
      if (data?.items.some((it) => it.task?.id === taskId)) keys.push(key);
    }
  }
  // Carried-over lists read other meetings' tasks: a conversion creates one,
  // finishing or deleting one takes it off.
  if (type === "task.created" || type === "task.updated" || type === "task.deleted") {
    keys.push(meetingKeys.carriedOverRoot);
  }
  return keys;
}

/** The keys a summary, action_item.* or minutes.* frame invalidates; null for any other frame. */
export function followThroughFrameKeys(type: string, payload: Record<string, string>): Keys | null {
  const id = payload.meeting_id;
  switch (type) {
    // A new summary replaces the pending AI action items; the action_item.*
    // events change the list itself (so no clerk converts an item twice).
    case "summary.created":
      return id ? [meetingKeys.summary(id), meetingKeys.activity(id), meetingKeys.actionItems(id)] : [];
    case "action_item.created":
    case "action_item.dismissed":
    case "action_item.restored":
      return id ? [meetingKeys.actionItems(id)] : [];
    case "action_item.converted":
      return id ? [meetingKeys.actionItems(id), meetingKeys.activity(id)] : [];
    case "minutes.created":
    case "minutes.reopened":
      return id ? [meetingKeys.minutes(id)] : [];
    case "minutes.finalized":
      return id ? [meetingKeys.minutes(id), meetingKeys.activity(id)] : [];
    default:
      return null;
  }
}
