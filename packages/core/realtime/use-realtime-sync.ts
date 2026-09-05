"use client";

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { WSClient } from "../api/ws-client";
import type { WSMessage } from "../api/ws-types";
import { agentKeys } from "../agents/hooks";
import { auditKeys } from "../audit/hooks";
import { chatKeys } from "../chat/hooks";
import { meetingKeys } from "../meetings/hooks";
import { taskKeys } from "../tasks/hooks";
import type { WSEventType } from "../types/events";
import { createInvalidateScheduler, shouldInvalidateMeetingDetail } from "./invalidate-scheduler";

/**
 * Central WS → cache sync for one workspace.
 *
 * Every event maps to the query keys it makes stale, and the cache is then
 * refreshed FROM THE API. Meeting detail skips invalidation when the cached
 * version is already >= the event version. Bursts coalesce into one debounced
 * invalidation wave per ~250ms.
 */
function keysFor(
  wsId: string,
  type: WSEventType,
  payload: Record<string, string>,
  qc: QueryClient,
) {
  const keys: readonly unknown[][] = [];
  const push = (k: readonly unknown[]) => (keys as unknown[][]).push([...k]);
  switch (type) {
    case "task.created":
    case "task.updated":
    case "task.deleted": {
      push(taskKeys.list(wsId));
      if (payload.task_id) {
        push(taskKeys.detail(payload.task_id));
        // The task's Activity list is the audit log's slice of this task, so
        // the same event that changed the task also made its history stale.
        push(auditKeys.history(wsId, "task", payload.task_id));
      }
      break;
    }
    case "task.comment_added": {
      if (payload.task_id) {
        push(taskKeys.comments(payload.task_id));
        push(auditKeys.history(wsId, "task", payload.task_id));
      }
      break;
    }
    case "workspace_agent.added": {
      push(agentKeys.workspace(wsId));
      break;
    }
    case "chat.message.created":
    case "chat.message.updated": {
      push(chatKeys.rooms(wsId));
      push(chatKeys.room(wsId));
      if (payload.room_id) {
        push(chatKeys.roomMessages(wsId, payload.room_id));
        const wsRoom = qc.getQueryData<{ room_id?: string }>(chatKeys.room(wsId));
        if (wsRoom?.room_id === payload.room_id) push(chatKeys.messages(wsId));
      }
      break;
    }
    case "chat.room.created":
    case "chat.room.updated":
    case "chat.room.activity":
    case "chat.room.member_added":
    case "chat.room.member_removed": {
      push(chatKeys.rooms(wsId));
      push(chatKeys.room(wsId));
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
    chatKeys.rooms(wsId),
    chatKeys.room(wsId),
    meetingKeys.list(wsId),
    meetingKeys.stats(wsId),
    meetingKeys.joinRequestsRoot,
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

    const offAny = client.onAny((msg: WSMessage) => {
      const payload = (msg.payload ?? {}) as Record<string, string>;
      const type = RENAMED_EVENTS[msg.type] ?? (msg.type as WSEventType);
      for (const queryKey of keysFor(wsId, type, payload, qc)) {
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
    };
  }, [client, wsId, qc]);
}
