"use client";

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { WSClient } from "../api/ws-client";
import type { WSMessage } from "../api/ws-types";
import { agentKeys } from "../agents/hooks";
import { aiKeys } from "../ai/hooks";
import { auditKeys } from "../audit/hooks";
import { billingKeys } from "../billing/hooks";
import { chatKeys } from "../chat/hooks";
import { meetingKeys } from "../meetings/hooks";
import { notificationKeys } from "../notifications/hooks";
import { orgMemberRootKey } from "../organizations/hooks";
import { peopleRootKey } from "../people/hooks";
import { planCacheUpdate } from "../tasks/cache-coordinator";
import { taskKeys } from "../tasks/hooks";
import type { WSEventType } from "../types/events";
import { createChatRealtimePatchScheduler } from "./chat-realtime-patch-scheduler";
import { createInvalidateScheduler, shouldInvalidateMeetingDetail } from "./invalidate-scheduler";

/**
 * Central WS → cache sync for one workspace.
 *
 * Chat message events patch the cache via GET /messages/{id} instead of
 * refetching full lists. Other domains still invalidate and refetch from API.
 * Meeting detail skips invalidation when the cached version is already >= the
 * event version. Bursts coalesce into one debounced wave per ~250ms.
 *
 * Work Management events go through `planCacheUpdate` (invalidate + refetch).
 * Frames carry ids only — never write the payload into query data or Zustand.
 */
function keysFor(
  wsId: string,
  type: WSEventType,
  payload: Record<string, string>,
  qc: QueryClient,
) {
  const keys: readonly unknown[][] = [];
  const push = (k: readonly unknown[]) => (keys as unknown[][]).push([...k]);

  const workMgmt = planCacheUpdate(wsId, { type, payload });
  if (workMgmt.keys.length > 0) {
    for (const k of workMgmt.keys) push(k);
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
    return keys;
  }

  switch (type) {
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
      break;
    }
    case "ai.usage.updated": {
      // A gateway call finished somewhere in the workspace: Settings → AI
      // and the quota line refetch; the payload is ids only.
      push(aiKeys.usages());
      if (payload.workspace_id) push(aiKeys.capabilities(payload.workspace_id));
      break;
    }
    case "subscription.changed":
    case "quota.threshold": {
      // Both are organization-scoped; the payload names the organization.
      if (payload.organization_id) push(billingKeys.current(payload.organization_id));
      break;
    }
    case "chat.room.created":
    case "chat.room.updated":
    case "chat.room.member_added":
    case "chat.room.member_removed": {
      push(chatKeys.rooms(wsId));
      push(chatKeys.room(wsId));
      if (payload.room_id) {
        push(chatKeys.roomMembers(wsId, payload.room_id));
      }
      break;
    }
    case "meeting.created":
    case "meeting.updated":
    case "meeting.deleted":
    case "meeting.started":
    case "meeting.ended":
    case "meeting.canceled":
    case "host.transferred": {
      push(meetingKeys.list(wsId));
      push(meetingKeys.stats(wsId));
      if (payload.meeting_id) {
        push(meetingKeys.activity(payload.meeting_id));
        push(meetingKeys.detail(payload.meeting_id));
      }
      break;
    }
    case "participant.invited":
    case "participant.removed":
    case "invitation.responded": {
      if (payload.meeting_id) {
        push(meetingKeys.participants(payload.meeting_id));
        push(meetingKeys.invitations(payload.meeting_id));
        push(meetingKeys.activity(payload.meeting_id));
        push(meetingKeys.detail(payload.meeting_id));
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
    case "summary.created": {
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
    case "organization.ownership_transferred": {
      // The directory and the membership list are keyed by organization SLUG,
      // because that is what the routes carry, while the event payload names
      // the organization by id. Invalidating the whole prefix is the honest
      // translation: both caches are small, and refetching one directory beats
      // showing a stale one.
      push(peopleRootKey);
      push(orgMemberRootKey);
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
        chatScheduler.scheduleUpsert(roomId, messageId);
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
        chatScheduler.scheduleMention(roomId, payload.sender_id ?? "");
        if (messageId) chatScheduler.scheduleUpsert(roomId, messageId);
        return true;
      }
      return false;
    }
    case "chat.room.activity": {
      chatScheduler.scheduleRoomActivity();
      return true;
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

/** Keys that could have gone stale while the socket was down. */
function allWorkspaceKeys(wsId: string) {
  return [
    taskKeys.list(wsId),
    taskKeys.myTasks(wsId),
    taskKeys.queryRoot(wsId),
    taskKeys.tableRoot(wsId),
    taskKeys.statuses(wsId),
    taskKeys.labels(wsId),
    taskKeys.properties(wsId),
    taskKeys.views(wsId),
    taskKeys.viewPrefs(wsId),
    taskKeys.pins(wsId),
    taskKeys.projects(wsId),
    chatKeys.rooms(wsId),
    chatKeys.room(wsId),
    meetingKeys.list(wsId),
    meetingKeys.stats(wsId),
    meetingKeys.joinRequestsRoot,
    notificationKeys.lists(),
    notificationKeys.unreadCount(),
  ];
}

function isMeetingDetailKey(queryKey: readonly unknown[]): boolean {
  return Array.isArray(queryKey) && queryKey[0] === "meeting" && typeof queryKey[1] === "string";
}

export function useRealtimeSync(client: WSClient | null, wsId: string): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!client || !wsId) return;

    const scheduler = createInvalidateScheduler(qc);
    const chatScheduler = createChatRealtimePatchScheduler(qc, wsId);

    const offAny = client.onAny((msg: WSMessage) => {
      const payload = (msg.payload ?? {}) as Record<string, string>;
      const eventType = RENAMED_EVENTS[msg.type] ?? (msg.type as WSEventType);
      if (handleChatRealtimeEvent(chatScheduler, eventType, payload)) {
        return;
      }
      for (const queryKey of keysFor(wsId, eventType, payload, qc)) {
        if (
          isMeetingDetailKey(queryKey) &&
          payload.meeting_id &&
          !shouldInvalidateMeetingDetail(qc, payload.meeting_id, payload.version)
        ) {
          continue;
        }
        scheduler.schedule(queryKey);
      }
    });
    const offReconnect = client.onReconnect(() => {
      for (const queryKey of allWorkspaceKeys(wsId)) scheduler.schedule(queryKey);
    });
    return () => {
      offAny();
      offReconnect();
      scheduler.dispose();
      void chatScheduler.dispose();
    };
  }, [client, wsId, qc]);
}
