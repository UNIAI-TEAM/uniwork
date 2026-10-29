"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/meeting-action-items";
import { invalidateTaskCollections } from "../tasks/invalidate";
import { meetingKeys } from "./hooks";
import { summaryQueryRetry } from "./summary-hooks";

export type {
  ConvertActionItemInput,
  ConvertActionItemsBody,
  MeetingActionItem,
  MeetingActionItemCounts,
  MeetingActionItems,
  MeetingCarriedOver,
  MeetingCarriedOverItem,
} from "../api/endpoints/meeting-action-items";

/** The meeting's action items with their state and tasks (spec meeting follow-through §6.2). */
export function useMeetingActionItems(meetingId: string) {
  return useQuery({
    queryKey: meetingKeys.actionItems(meetingId),
    queryFn: () => api.getMeetingActionItems(meetingId),
    enabled: !!meetingId,
    retry: summaryQueryRetry,
  });
}

/** Open tasks from the earlier ended meetings of the same project or series (spec §6.5, follow-4); empty without either. */
export function useMeetingCarriedOverItems(meetingId: string) {
  return useQuery({
    queryKey: meetingKeys.carriedOver(meetingId),
    queryFn: () => api.getMeetingCarriedOverItems(meetingId),
    enabled: !!meetingId,
    retry: summaryQueryRetry,
  });
}

/**
 * Every command on the items waits for the server (State Rules: a create is
 * never optimistic; dismiss and restore follow for simplicity) and refreshes
 * the list on settle, not only on success: a refusal such as
 * action_item_not_pending means the list on screen is out of date.
 */
function useActionItemMutation<V, R>(meetingId: string, fn: (v: V) => Promise<R>, workspaceId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.actionItems(meetingId) });
      if (!workspaceId) return;
      void qc.invalidateQueries({ queryKey: meetingKeys.activity(meetingId) });
      return invalidateTaskCollections(qc, workspaceId);
    },
  });
}

export function useAddMeetingActionItem(meetingId: string) {
  return useActionItemMutation(meetingId, (body: api.AddMeetingActionItemBody) => api.addMeetingActionItem(meetingId, body));
}

export function useDismissMeetingActionItem(meetingId: string) {
  return useActionItemMutation(meetingId, (v: { itemId: string; reason: string }) =>
    api.dismissMeetingActionItem(meetingId, v.itemId, v.reason),
  );
}

export function useRestoreMeetingActionItem(meetingId: string) {
  return useActionItemMutation(meetingId, (itemId: string) => api.restoreMeetingActionItem(meetingId, itemId));
}

/** Links a pending item to an existing task; refreshes the timeline and the task collections like a conversion. */
export function useLinkMeetingActionItem(workspaceId: string, meetingId: string) {
  return useActionItemMutation(
    meetingId,
    (v: { itemId: string; taskId: string }) => api.linkMeetingActionItem(meetingId, v.itemId, v.taskId),
    workspaceId,
  );
}

/** Turns pending items into tasks; also refreshes the timeline and every task collection. */
export function useConvertMeetingActionItems(workspaceId: string, meetingId: string) {
  return useActionItemMutation(
    meetingId,
    (body: api.ConvertActionItemsBody) => api.convertMeetingActionItems(meetingId, body),
    workspaceId,
  );
}

/** Takes back a conversion the caller made moments ago; refreshes what a conversion refreshes. */
export function useUndoConvertActionItems(workspaceId: string, meetingId: string) {
  return useActionItemMutation(
    meetingId,
    (actionItemIds: string[]) => api.undoConvertMeetingActionItems(meetingId, actionItemIds),
    workspaceId,
  );
}
