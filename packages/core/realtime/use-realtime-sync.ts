"use client";

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { WSClient } from "../api/ws-client";
import type { WSMessage } from "../api/ws-types";
import { calendarKeys } from "../calendar/keys";
import { agentKeys } from "../agents/hooks";
import { aiKeys } from "../ai/hooks";
import { auditKeys } from "../audit/hooks";
import { emitQuotaThreshold } from "../billing/quota-threshold-bus";
import { billingKeys } from "../billing/hooks";
import { chatKeys } from "../chat/hooks";
import { catchUpOnChatSubscribeAck, refreshLoadedRoomTimelines } from "../chat/room-timeline";
import { graphKeys } from "../graph/keys";
import { invalidateEmailHubCounts, invalidateEmailHubForInboxChanged } from "../email-hub/query-cache";
import { homeKeys } from "../home/keys";
import { meetingKeys } from "../meetings/hooks";
import { MOTION_TALLY_INVALIDATE_MS, motionKeys } from "../meetings/motion-hooks";
import { notificationKeys } from "../notifications/hooks";
import { orgMemberRootKey } from "../organizations/hooks";
import { peopleRootKey } from "../people/hooks";
import { planCacheUpdate } from "../tasks/cache-coordinator";
import { taskKeys } from "../tasks/hooks";
import { applyTaskPatchFrame } from "../tasks/realtime-task-patch";
import type { WSEventType } from "../types/events";
import { workspaceKeys } from "../workspaces/keys";
import { createChatRealtimePatchScheduler } from "./chat-realtime-patch-scheduler";
import { documentFrameKeys } from "./document-events";
import { changesOwnMembership, ownMembershipKeys, reloadSessionUser } from "./own-membership";
import {
  createInvalidateScheduler,
  shouldInvalidateMeetingDetail,
  TRANSCRIPT_INVALIDATE_MS,
} from "./invalidate-scheduler";
import { allWorkspaceKeys } from "./reconnect-keys";
import { shouldInvalidateCalendar } from "./should-invalidate-calendar";
import { createSourcesRefresher } from "./source-events";

/** The projector trails a task event (ADR 0019); the second graph refresh waits it out. */
const GRAPH_INVALIDATE_MS = 3_000;

/**
 * Central WS → cache sync for one workspace.
 *
 * Chat message events patch the cache via GET /messages/{id} instead of
 * refetching full lists. Other domains still invalidate and refetch from API.
 * Meeting detail skips invalidation when the cached version is already >= the
 * event version. Bursts coalesce into one debounced wave per ~250ms.
 *
 * Work Management events go through `planCacheUpdate` (invalidate + refetch).
 * Frames are never written into Zustand, and into query data only through the
 * one exception ADR 0015 allows: a `task.updated` frame's Patch fields patch
 * the task's cached records that already sit at the frame's `revision_before`
 * — the detail entry and the task's rows in list-style caches
 * (`applyTaskPatchFrame`, applied here before the keys are returned). When the
 * detail entry was patched the frame skips the detail key; list roots and
 * every other key still invalidate, so row order and placement come from the API.
 */
function calendarKeyForFrame(
  wsId: string,
  type: WSEventType,
  payload: Record<string, string>,
): readonly unknown[] | null {
  if (!shouldInvalidateCalendar(type)) return null;
  const frameWs = payload.workspace_id;
  if (frameWs && frameWs !== wsId) return null;
  return calendarKeys.all(frameWs ?? wsId);
}

function keysFor(
  wsId: string,
  type: WSEventType,
  payload: Record<string, string>,
  qc: QueryClient,
) {
  const keys: readonly unknown[][] = [];
  const push = (k: readonly unknown[]) => (keys as unknown[][]).push([...k]);
  const pushCalendar = () => {
    const cal = calendarKeyForFrame(wsId, type, payload);
    if (cal) push(cal);
  };

  const workMgmt = planCacheUpdate(wsId, { type, payload });
  if (workMgmt.keys.length > 0) {
    const patchedDetail =
      workMgmt.patch && applyTaskPatchFrame(qc, wsId, workMgmt.patch).detailPatched
        ? JSON.stringify(taskKeys.detail(workMgmt.patch.taskId))
        : null;
    for (const k of workMgmt.keys) {
      if (patchedDetail !== null && JSON.stringify(k) === patchedDetail) continue;
      push(k);
    }
    // Activity tab is the audit slice of this task; keep it in sync with
    // task/comment mutations that the coordinator maps.
    if (
      payload.task_id &&
      (type === "task.created" ||
        type === "task.updated" ||
        type === "task.deleted" ||
        type === "task.comment_added" ||
        type === "task.comment_updated" ||
        type === "task.comment_deleted" ||
        type === "task.comment_resolved" ||
        type === "task.comment_unresolved")
    ) {
      push(auditKeys.history(wsId, "task", payload.task_id));
    }
    // The home summary lists open work assigned to the viewer; any task
    // lifecycle event can change it.
    if (type === "task.created" || type === "task.updated" || type === "task.deleted") {
      push(homeKeys.summary(wsId));
    }
    pushCalendar();
    return keys;
  }

  const documentFrame = documentFrameKeys(wsId, type, payload);
  if (documentFrame) {
    for (const k of documentFrame) push(k);
    return keys;
  }

  switch (type) {
    case "workspace.updated": {
      // Name, description, icon, slug or task prefix changed: the switcher,
      // the picker and the open workspace refetch. The by-slug prefix also
      // covers a workspace opened under an old slug.
      push(workspaceKeys.list());
      push(workspaceKeys.allBySlugs());
      // Task identifiers carry the prefix; the payload does not say which
      // field changed, so this workspace's task caches refetch too.
      push(taskKeys.list(wsId));
      push(taskKeys.myTasks(wsId));
      push(taskKeys.queryRoot(wsId));
      push(taskKeys.groupedRoot(wsId));
      push(taskKeys.tableRoot(wsId));
      push(taskKeys.details());
      break;
    }
    case "workspace_agent.added": {
      push(agentKeys.workspace(wsId));
      break;
    }
    case "notification.created": {
      // Arrives on the user scope, from any workspace: refresh every cached
      // list and the account-level badge. Payload is ids only; the row itself
      // comes back from the API.
      push(notificationKeys.lists());
      push(notificationKeys.unreadCount());
      push(chatKeys.unreadSummary());
      push(homeKeys.summary(wsId));
      break;
    }
    case "ai.usage.updated": {
      // A gateway call finished somewhere in the workspace: Settings → AI
      // and the quota line refetch; the payload is ids only.
      push(aiKeys.usages());
      if (payload.workspace_id) push(aiKeys.capabilities(payload.workspace_id));
      break;
    }
    case "subscription.changed": {
      if (payload.organization_id) push(billingKeys.current(payload.organization_id));
      break;
    }
    case "quota.threshold": {
      if (payload.organization_id) push(billingKeys.current(payload.organization_id));
      if (payload.organization_id && payload.user_id) {
        emitQuotaThreshold({
          organizationId: payload.organization_id,
          userId: payload.user_id,
        });
      }
      break;
    }
    case "chat.room.created":
    case "chat.room.updated":
    case "chat.room.member_added":
    case "chat.room.members_added":
    case "chat.room.member_removed": {
      push(chatKeys.rooms(wsId));
      push(chatKeys.room(wsId));
      if (payload.room_id) {
        push(chatKeys.roomMembers(wsId, payload.room_id));
      }
      break;
    }
    case "chat.room.member_read": {
      // Someone's read cursor moved: only this room's "N người đã xem" changes.
      if (payload.room_id) push(chatKeys.roomMembers(wsId, payload.room_id));
      break;
    }
    case "chat.channel.created":
    case "chat.channel.updated":
    case "chat.channel.archived": {
      push(chatKeys.rooms(wsId)); // through the chat scheduler (isChatRoomsKey)
      push(["chat", "channels", wsId]);
      push(["chat", "project-channels", wsId]);
      break;
    }
    case "chat.voice.recording.started":
    case "chat.voice.recording.stopped": {
      if (payload.room_id) {
        push(chatKeys.voiceRecordings(wsId, payload.room_id));
      }
      break;
    }
    case "chat.follow_up.created":
    case "chat.follow_up.updated":
    case "chat.follow_up.completed":
    case "chat.follow_up.deleted": {
      push(chatKeys.followUps(wsId));
      break;
    }
    case "meeting.created":
    case "meeting.updated":
    case "meeting.deleted":
    case "meeting.started":
    case "meeting.ended":
    case "meeting.canceled":
    case "host.transferred": {
      push(homeKeys.summary(wsId));
      push(meetingKeys.list(wsId));
      push(meetingKeys.stats(wsId));
      if (payload.meeting_id) {
        push(meetingKeys.activity(payload.meeting_id));
        push(meetingKeys.detail(payload.meeting_id));
        // The quorum lives on the meeting; the roll shows whether it is met.
        push(meetingKeys.attendance(payload.meeting_id));
        // Ending the meeting closes and counts every open motion.
        if (type === "meeting.ended") push(meetingKeys.motions(payload.meeting_id));
      }
      pushCalendar();
      break;
    }
    case "participant.invited":
    case "participant.removed":
    case "invitation.responded": {
      push(homeKeys.summary(wsId));
      if (payload.meeting_id) {
        push(meetingKeys.participants(payload.meeting_id));
        push(meetingKeys.invitations(payload.meeting_id));
        push(meetingKeys.activity(payload.meeting_id));
        push(meetingKeys.detail(payload.meeting_id));
        // A roster change moves someone onto or off the roll.
        push(meetingKeys.attendance(payload.meeting_id));
      }
      pushCalendar();
      break;
    }
    case "participant.updated": {
      if (payload.meeting_id) {
        push(meetingKeys.participants(payload.meeting_id));
        push(meetingKeys.attendance(payload.meeting_id));
        // Standing decides who joins the next roll and what my_ballot says.
        push(meetingKeys.motions(payload.meeting_id));
      }
      break;
    }
    case "attendance.marked":
    case "attendance.updated": {
      if (payload.meeting_id) push(meetingKeys.attendance(payload.meeting_id));
      break;
    }
    case "attendance.finalized":
    case "attendance.reopened": {
      if (payload.meeting_id) {
        push(meetingKeys.attendance(payload.meeting_id));
        push(meetingKeys.activity(payload.meeting_id));
        push(meetingKeys.detail(payload.meeting_id));
      }
      break;
    }
    case "motion.created":
    case "motion.updated":
    case "motion.deleted": {
      if (payload.meeting_id) push(meetingKeys.motions(payload.meeting_id));
      break;
    }
    case "motion.ballot_cast": {
      // A ballot moves the tallies only; the voter's own roll refreshes from
      // its mutation, so a room voting at once does not refetch my-ballots.
      if (payload.meeting_id) push(motionKeys.list(payload.meeting_id));
      break;
    }
    case "motion.opened":
    case "motion.closed": {
      if (payload.meeting_id) {
        push(meetingKeys.motions(payload.meeting_id));
        // Opening and closing are timeline rows.
        push(meetingKeys.activity(payload.meeting_id));
      }
      break;
    }
    case "join_request.created":
    case "join_request.approved":
    case "join_request.rejected":
    case "join_request.canceled": {
      if (payload.meeting_id) {
        push(meetingKeys.joinRequests(payload.meeting_id));
        push(meetingKeys.participants(payload.meeting_id));
        push(meetingKeys.activity(payload.meeting_id));
        push(meetingKeys.attendance(payload.meeting_id));
      }
      break;
    }
    case "invite_link.revoked": {
      if (payload.meeting_id) {
        push(meetingKeys.inviteLinks(payload.meeting_id));
        push(meetingKeys.activity(payload.meeting_id));
        push(meetingKeys.detail(payload.meeting_id));
      }
      break;
    }
    case "transcript.appended": {
      if (payload.meeting_id) push(meetingKeys.transcript(payload.meeting_id));
      break;
    }
    case "chat.message": {
      if (payload.meeting_id) push(meetingKeys.chat(payload.meeting_id));
      break;
    }
    // A new summary, or items of the current one that just became tasks
    // (their task_id, so no host converts them twice).
    case "summary.created":
    case "summary.tasks_linked": {
      if (payload.meeting_id) {
        push(meetingKeys.summary(payload.meeting_id));
        push(meetingKeys.activity(payload.meeting_id));
      }
      break;
    }
    case "profile.updated":
    case "department.created":
    case "department.updated":
    case "department.archived":
    case "member.deactivated":
    case "member.reactivated":
    case "member.left":
    case "member.role_changed":
    case "invitation.revoked":
    case "member.invited":
    case "member.joined":
    case "member.removed":
    case "organization.closed":
    case "organization.ownership_transferred": {
      // The directory and the membership list are keyed by organization SLUG,
      // because that is what the routes carry, while the event payload names
      // the organization by id. Invalidating the whole prefix is the honest
      // translation: both caches are small, and refetching one directory beats
      // showing a stale one.
      push(peopleRootKey);
      push(orgMemberRootKey);
      if (changesOwnMembership(type, payload)) ownMembershipKeys.forEach(push);
      break;
    }
    case "recording.started":
    case "recording.stopped":
    case "recording.ready": {
      if (payload.meeting_id) {
        push(meetingKeys.recordings(payload.meeting_id));
        push(meetingKeys.activity(payload.meeting_id));
      }
      break;
    }
    default:
      break;
  }
  return keys;
}

function handleChatRealtimeEvent(
  chatScheduler: ReturnType<typeof createChatRealtimePatchScheduler>,
  type: WSEventType,
  payload: Record<string, string>,
): boolean {
  const roomId = payload.room_id;
  const messageId = payload.message_id;
  switch (type) {
    case "chat.message.created":
    case "chat.message.updated":
    case "chat.thread.replied": {
      if (roomId && messageId) {
        // A thread reply is not unread on the main timeline: the sidebar counts thread_root_id IS NULL.
        const created = type === "chat.message.created" && !payload.thread_root_id;
        chatScheduler.scheduleUpsert(roomId, messageId, created, payload.sender_id);
        return true;
      }
      return false;
    }
    case "chat.message.deleted": {
      if (roomId && messageId) {
        chatScheduler.scheduleDelete(roomId, messageId);
        return true;
      }
      return false;
    }
    case "chat.mention.created": {
      if (roomId) {
        if (!payload.thread_root_id) chatScheduler.scheduleMention(roomId, payload.sender_id ?? "");
        if (messageId) chatScheduler.scheduleUpsert(roomId, messageId);
        return true;
      }
      return false;
    }
    case "chat.room.activity": {
      chatScheduler.scheduleRoomActivity();
      return true;
    }
    case "chat.message.linked": {
      if (messageId) {
        chatScheduler.scheduleMessageLinked(roomId ?? "", messageId);
        return true;
      }
      return false;
    }
    case "chat.thread.linked":
    case "chat.thread.unlinked": {
      const threadRootId = payload.thread_root_id;
      if (threadRootId) {
        chatScheduler.scheduleThreadLinked(roomId ?? "", threadRootId);
        return true;
      }
      return false;
    }
    default:
      return false;
  }
}

/**
 * `comment.created` was renamed to `task.comment_added` when the catalogue
 * landed. The old name is accepted for one release so a client that reconnects
 * to a server mid-deploy still refreshes its comments; drop this map once both
 * sides are past that release.
 */
const RENAMED_EVENTS: Record<string, WSEventType> = {
  "comment.created": "task.comment_added",
};

/**
 * Events after which the projector re-reads a TASK node. The refresh covers
 * the whole workspace graph, not that node: an open Related panel lists its
 * neighbours by title and status, and the changed task may be one of them.
 */
function changesTaskGraph(type: WSEventType, payload: Record<string, string>): boolean {
  if (!payload.task_id) return false;
  return (
    type === "task.created" ||
    type === "task.updated" ||
    type === "task.deleted" ||
    type === "chat.thread.linked" ||
    type === "chat.thread.unlinked"
  );
}

function isMeetingDetailKey(queryKey: readonly unknown[]): boolean {
  return Array.isArray(queryKey) && queryKey[0] === "meeting" && typeof queryKey[1] === "string";
}

/** The sidebar list: every refresh of it goes through the chat scheduler. */
function isChatRoomsKey(wsId: string, queryKey: readonly unknown[]): boolean {
  return JSON.stringify(queryKey) === JSON.stringify(chatKeys.rooms(wsId));
}

function isTranscriptKey(queryKey: readonly unknown[]): boolean {
  return Array.isArray(queryKey) && queryKey[0] === "meeting-transcript";
}

export function useRealtimeSync(client: WSClient | null, wsId: string): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!client || !wsId) return;

    const scheduler = createInvalidateScheduler(qc);
    const transcriptScheduler = createInvalidateScheduler(qc, TRANSCRIPT_INVALIDATE_MS);
    const tallyScheduler = createInvalidateScheduler(qc, MOTION_TALLY_INVALIDATE_MS);
    const graphScheduler = createInvalidateScheduler(qc, GRAPH_INVALIDATE_MS);
    const sources = createSourcesRefresher(qc, wsId, scheduler);
    const chatScheduler = createChatRealtimePatchScheduler(qc, wsId);

    const offAny = client.onAny((msg: WSMessage) => {
      const payload = (msg.payload ?? {}) as Record<string, string>;
      if (catchUpOnChatSubscribeAck(qc, wsId, msg.type, payload)) return;
      const eventType = RENAMED_EVENTS[msg.type] ?? (msg.type as WSEventType);
      if (changesTaskGraph(eventType, payload)) {
        // The graph trails its sources (ADR 0019): refresh now and once more
        // later. Ahead of every early return and of the patched-detail skip.
        scheduler.schedule(graphKeys.workspace(wsId));
        graphScheduler.schedule(graphKeys.workspace(wsId));
      }
      // Ahead of the chat and email early returns: those frames are the ones
      // that may carry a source file (documents home, "other modules").
      sources.onFrame(eventType, payload);
      if (changesOwnMembership(eventType, payload)) void reloadSessionUser();
      if (handleChatRealtimeEvent(chatScheduler, eventType, payload)) {
        if (
          payload.room_id &&
          (eventType === "chat.message.created" || eventType === "chat.message.updated")
        ) {
          scheduler.schedule(chatKeys.voiceRecordings(wsId, payload.room_id));
        }
        return;
      }
      if (eventType === "email_hub.inbox_changed" && payload.account_id) {
        invalidateEmailHubForInboxChanged(qc, wsId, payload.account_id);
        return;
      }
      if (eventType === "email_hub.new_mail" && payload.account_id) {
        // new_mail duplicates the later inbox_changed mailbox refresh. Keep
        // list/detail caches intact, but refresh the lightweight count badges.
        invalidateEmailHubCounts(qc, wsId, payload.account_id);
        return;
      }
      for (const queryKey of keysFor(wsId, eventType, payload, qc)) {
        if (isChatRoomsKey(wsId, queryKey)) {
          chatScheduler.scheduleRoomActivity();
          continue;
        }
        if (
          isMeetingDetailKey(queryKey) &&
          payload.meeting_id &&
          !shouldInvalidateMeetingDetail(qc, payload.meeting_id, payload.version)
        ) {
          continue;
        }
        if (isTranscriptKey(queryKey)) {
          transcriptScheduler.schedule(queryKey);
          continue;
        }
        if (eventType === "motion.ballot_cast") {
          tallyScheduler.schedule(queryKey);
          continue;
        }
        scheduler.schedule(queryKey);
      }
    });
    const offReconnect = client.onReconnect(() => {
      for (const queryKey of allWorkspaceKeys(wsId)) {
        if (isChatRoomsKey(wsId, queryKey)) chatScheduler.scheduleRoomActivity();
        else scheduler.schedule(queryKey);
      }
      refreshLoadedRoomTimelines(qc, wsId);
    });
    return () => {
      offAny();
      offReconnect();
      scheduler.dispose();
      transcriptScheduler.dispose();
      tallyScheduler.dispose();
      graphScheduler.dispose();
      sources.dispose();
      void chatScheduler.dispose();
    };
  }, [client, wsId, qc]);
}
