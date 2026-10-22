import { parseWithFallback } from "../schema";
import { readStatusOk } from "./chat-endpoint-kit";
import { ChatVoiceTokenSchema, PendingChatVoiceInvitesSchema, enc } from "./chat-schemas";
import type { ChatRequest, ChatVoiceToken, PendingChatVoiceInvite } from "./chat-schemas";

/**
 * The call signalling endpoints (pending invites, LiveKit token, invite,
 * accept, hang up) and the typing signal over any transport: chat-voice.ts
 * binds them to the web's, the phone (apps/chat-mobile, ADR 0011) to its own.
 * Recordings stay in chat-voice.ts: their playback reads a Blob through the
 * web transport.
 */

export function createChatVoiceApi(request: ChatRequest) {
  const room = (workspaceId: string, roomId: string) => `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}`;

  return {
    async listPendingChatVoiceInvites(workspaceId: string): Promise<PendingChatVoiceInvite[]> {
      const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/voice/pending`);
      const parsed = parseWithFallback(raw, PendingChatVoiceInvitesSchema, { invites: [] }, {
        endpoint: "GET /api/v1/workspaces/{ws}/chat/voice/pending",
      });
      return parsed.invites ?? [];
    },

    /** The LiveKit url and token of a call; null when the answer carries none. */
    async mintChatVoiceToken(roomId: string, callId: string): Promise<ChatVoiceToken | null> {
      const raw = await request("/api/v1/chat/voice/token", {
        method: "POST",
        body: { room_id: roomId.trim(), call_id: callId.trim() },
      });
      return parseWithFallback<ChatVoiceToken | null>(raw, ChatVoiceTokenSchema, null, {
        endpoint: "POST /api/v1/chat/voice/token",
      });
    },

    signalChatVoiceInvite(workspaceId: string, roomId: string, callId: string, video = false): Promise<boolean> {
      return readStatusOk(
        request(`${room(workspaceId, roomId)}/voice/invite`, {
          method: "POST",
          body: video ? { call_id: callId, video: true } : { call_id: callId },
        }),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/invite",
      );
    },

    signalChatVoiceAccept(workspaceId: string, roomId: string, callId: string): Promise<boolean> {
      return readStatusOk(
        request(`${room(workspaceId, roomId)}/voice/accept`, { method: "POST", body: { call_id: callId } }),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/accept",
      );
    },

    /** A positive duration is the call's length for the call log; anything else is left out. */
    signalChatVoiceHangup(workspaceId: string, roomId: string, callId: string, durationSeconds?: number): Promise<boolean> {
      const body = durationSeconds != null && durationSeconds > 0 ? { call_id: callId, duration_seconds: durationSeconds } : { call_id: callId };
      return readStatusOk(
        request(`${room(workspaceId, roomId)}/voice/hangup`, { method: "POST", body }),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/hangup",
      );
    },

    signalChatTyping(workspaceId: string, roomId: string): Promise<boolean> {
      return readStatusOk(
        request(`${room(workspaceId, roomId)}/typing`, { method: "POST", body: {} }),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/typing",
      );
    },
  };
}
