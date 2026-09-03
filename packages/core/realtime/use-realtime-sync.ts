"use client";

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { WSClient } from "../api/ws-client";
import type { WSMessage } from "../api/ws-types";
import { chatKeys } from "../chat/hooks";
import { meetingKeys } from "../meetings/hooks";
import { taskKeys } from "../tasks/hooks";
import type { WSEventType } from "../types/events";

/**
 * Central WS → cache sync for one workspace.
 *
 * Every event maps to the query keys it makes stale, and the cache is then
 * refreshed FROM THE API. The frame's payload is never written into a query
 * or a store: it carries ids, and the server's reply is the only source of
 * row data — which keeps a client this server outgrew from rendering a shape
 * it does not understand.
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
      if (payload.task_id) push(taskKeys.detail(payload.task_id));
      break;
    }
    case "comment.created": {
      if (payload.task_id) push(taskKeys.comments(payload.task_id));
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
    case "chat.room.activity": {
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
        push(meetingKeys.detail(payload.meeting_id));
        push(meetingKeys.activity(payload.meeting_id));
      }
      break;
    }
    case "participant.invited":
    case "participant.removed":
    case "invitation.responded": {
      if (payload.meeting_id) {
        push(meetingKeys.detail(payload.meeting_id));
        push(meetingKeys.participants(payload.meeting_id));
        push(meetingKeys.invitations(payload.meeting_id));
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
      }
      break;
    }
    case "invite_link.revoked": {
      if (payload.meeting_id) {
        push(meetingKeys.detail(payload.meeting_id));
        push(meetingKeys.inviteLinks(payload.meeting_id));
        push(meetingKeys.activity(payload.meeting_id));
      }
      break;
    }
    case "transcript.appended": {
      if (payload.meeting_id) push(meetingKeys.transcript(payload.meeting_id));
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
      // An event this client predates. Nothing is stale that we know of.
      break;
  }
  return keys;
}

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

export function useRealtimeSync(client: WSClient | null, wsId: string): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!client || !wsId) return;

    const offAny = client.onAny((msg: WSMessage) => {
      const payload = (msg.payload ?? {}) as Record<string, string>;
      for (const queryKey of keysFor(wsId, msg.type as WSEventType, payload, qc)) {
        void qc.invalidateQueries({ queryKey });
      }
    });
    const offReconnect = client.onReconnect(() => {
      for (const queryKey of allWorkspaceKeys(wsId)) void qc.invalidateQueries({ queryKey });
    });
    return () => {
      offAny();
      offReconnect();
    };
  }, [client, wsId, qc]);
}
