import type { QueryClient } from "@tanstack/react-query";
import type { MeetingActionItems } from "../api/endpoints/meeting-action-items";
import { meetingKeys } from "../meetings/hooks";
import { isTaskLifecycleEvent } from "../tasks/cache-coordinator";

type Keys = (readonly unknown[])[];

/**
 * The meeting keys a task lifecycle frame invalidates. Split out of
 * use-realtime-sync (max-lines) with the follow-through frames below.
 */
export function meetingTaskFrameKeys(qc: QueryClient, type: string, taskId: string | undefined): Keys {
  const keys: Keys = [];
  // A converted action item shows its task's state; only cached lists that
  // hold this task refetch.
  if ((type === "task.updated" || type === "task.deleted" || type === "task.trashed") && taskId) {
    for (const [key, data] of qc.getQueriesData<MeetingActionItems>({ queryKey: meetingKeys.actionItemsRoot })) {
      if (data?.items.some((it) => it.task?.id === taskId)) keys.push(key);
    }
  }
  // While its task sits in the trash an item reads as pending with no task,
  // so no list names the restored task: every action item list refetches.
  if (type === "task.restored") keys.push(meetingKeys.actionItemsRoot);
  // Carried-over lists read other meetings' tasks: a conversion creates one,
  // finishing or deleting one takes it off.
  if (isTaskLifecycleEvent(type)) {
    keys.push(meetingKeys.carriedOverRoot);
  }
  return keys;
}

/** The keys a summary, action_item.*, minutes.* or note.* frame invalidates; null for any other frame. */
export function followThroughFrameKeys(type: string, payload: Record<string, string>): Keys | null {
  const id = payload.meeting_id;
  switch (type) {
    // A new summary replaces the pending AI action items; the action_item.*
    // events change the list itself (so no clerk converts an item twice).
    // The minutes count the pending items their finalize warns about.
    case "summary.created":
      return id ? [meetingKeys.summary(id), meetingKeys.activity(id), meetingKeys.actionItems(id), meetingKeys.minutes(id)] : [];
    case "action_item.created":
    case "action_item.dismissed":
    case "action_item.restored":
      return id ? [meetingKeys.actionItems(id), meetingKeys.minutes(id)] : [];
    case "action_item.converted":
      return id ? [meetingKeys.actionItems(id), meetingKeys.activity(id), meetingKeys.minutes(id)] : [];
    case "minutes.created":
    case "minutes.reopened":
      return id ? [meetingKeys.minutes(id)] : [];
    case "minutes.finalized":
      return id ? [meetingKeys.minutes(id), meetingKeys.activity(id)] : [];
    // The shared notes the UNI feed lists: added, edited or deleted (UNI-2217).
    case "note.created":
    case "note.updated":
    case "note.deleted":
      return id ? [meetingKeys.notes(id)] : [];
    default:
      return null;
  }
}
